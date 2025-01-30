import { ChatOpenAI } from "@langchain/openai";
import { DynamicTool } from "@langchain/core/tools";
import { createOpenAIFunctionsAgent, AgentExecutor } from "langchain/agents";
import { OpenAIFunctionsAgentOutputParser } from "langchain/agents/openai/output_parser";
// import { AgentExecutor } from "langchain/agents";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import PocketBase from 'pocketbase';
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';

const app = express();
app.use(express.json());

// CORS configuration
const corsOptions = {
    origin: ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:4200', 'https://gauntlet-autocrm-mvp.fly.dev', 'https://gauntlet-autocrm.netlify.app'], // Added port 4200
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true // Enable if you're using cookies/sessions
};

// Apply CORS middleware
app.use(cors(corsOptions));


// Initialize PocketBase client
const pb = new PocketBase(process.env.POCKETBASE_URL);

// Authenticate as admin
await pb.admins.authWithPassword(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);

// Create tool to fetch ticket and its messages
const getTicketMessagesTool = new DynamicTool({
    name: "get_ticket_messages",
    description: "Fetches a ticket and all its associated messages given a ticket ID",
    func: async (ticketId) => {
        try {
            // Fetch the ticket
            await pb.admins.authWithPassword(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);

            const ticket = await pb.collection('tickets').getOne(ticketId);
            console.log('ticket ==============> ',ticket);
            
            // Fetch associated messages
            const messages = await pb.collection('ticketMessages').getList(1, 50, {
                filter: `ticket = "${ticketId}"`,
                sort: 'created',
            });

            // Combine ticket and messages data
            const result = {
                ticket: ticket,
                messages: messages.items.map(msg => msg.content)
            };

            return JSON.stringify(result);
        } catch (error) {
            return `Error fetching ticket data: ${error.message}`;
        }
    }
});

// First, let's create a new tool for getting ticket details
const getTicketDetailsTool = new DynamicTool({
    name: "get_ticket_details",
    description: "Get detailed information about a ticket including the assignee's name",
    func: async (ticket_id) => {
        const ticket = await pb.collection('tickets').getOne(ticket_id, {
            expand: 'assignee'
        });
        return JSON.stringify({
            status: ticket.status,
            title: ticket.title,
            created: ticket.created,
            assigneeName: ticket.expand?.assignee?.name || 'Valued Customer'
        });
    }
});

// Create the ChatOpenAI model instance
const model = new ChatOpenAI({
    temperature: 0,
    modelName: "gpt-4",
    openAIApiKey: process.env.OPENAI_API_KEY
});

// Create the prompt for the agent
const prompt = ChatPromptTemplate.fromMessages([
    ["system", "You are a helpful AI assistant that summarizes support tickets."],
    ["human", "{input}"],
    new MessagesPlaceholder("agent_scratchpad"),
]);

// Create the agent
const agent = await createOpenAIFunctionsAgent({
    llm: model,
    tools: [getTicketMessagesTool],
    prompt: prompt
});

const executor = new AgentExecutor({
    agent,
    tools: [getTicketMessagesTool],
    verbose: true,
    maxIterations: 3,
});

// Function to summarize ticket messages
async function summarizeTicketMessages(ticketId) {
    const prompt = `Summarize all ticket messages in ticket ${ticketId}. 
    First fetch the ticket and messages using the get_ticket_messages tool, 
    then create a well-structured markdown summary of the conversation.
    Include key points, decisions, and outcomes if any.`;

    const result = await executor.call({
        input: prompt
    });

    return result.output;
}

// Example usage
// try {
//     const summary = await summarizeTicketMessages("c3oi15w89jl52t3");
//     console.log(summary);
// } catch (error) {
//     console.error("Error:", error);
// }


app.post('/letter', async (req, res) => {
    try {
        const { ticket_id } = req.body;

        if (!ticket_id) {
            return res.status(400).json({
                success: false,
                error: "ticket_id is required in request body"
            });
        }

        // Update the agent with both tools
        const prompt = ChatPromptTemplate.fromMessages([
            ["system", "You are a helpful AI assistant that writes personalized support ticket letters. Be warm, professional, and reference specific details from the ticket."],
            ["human", `Please write a personalized letter about ticket ${ticket_id}. Start with "Hi [Name]," and make sure to:
                1. Reference specific details from their ticket
                2. Explain the current status in a friendly way
                3. Mention that our teams are working diligently
                4. Be empathetic and professional
                5. End with a warm closing`],
            new MessagesPlaceholder("agent_scratchpad"),
        ]);

        const agent = await createOpenAIFunctionsAgent({
            llm: model,
            tools: [getTicketMessagesTool, getTicketDetailsTool],
            prompt: prompt
        });

        const executor = new AgentExecutor({
            agent,
            tools: [getTicketMessagesTool, getTicketDetailsTool],
            verbose: true,
            maxIterations: 3,
        });

        const result = await executor.invoke({
            input: `Write a personalized letter for ticket ${ticket_id}`
        });

        return res.status(200).json({
            success: true,
            data: {
                input: {
                    ticket_id
                },
                output: result.output
            }
        });

    } catch (error) {
        console.error('Error in /letter endpoint:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'An error occurred while generating the letter'
        });
    }
});

app.post('/summary', async (req, res) => {
    try {
        // Extract ticket_id from request body
        const { ticket_id } = req.body;

        if (!ticket_id) {
            return res.status(400).json({
                success: false,
                error: "ticket_id is required in request body"
            });
        }

        // Generate summary using the existing function
        const summary = await summarizeTicketMessages(ticket_id);

        // Return response with input and output
        return res.status(200).json({
            success: true,
            data: {
                input: {
                    ticket_id: ticket_id
                },
                output: summary
            }
        });

    } catch (error) {
        console.error('Error in /summary endpoint:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'An error occurred while generating the summary'
        });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
