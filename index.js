import { ChatOpenAI } from "@langchain/openai";
import { DynamicTool } from "@langchain/core/tools";
import { createOpenAIFunctionsAgent, AgentExecutor } from "langchain/agents";
import { OpenAIFunctionsAgentOutputParser } from "langchain/agents/openai/output_parser";
// import { AgentExecutor } from "langchain/agents";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import PocketBase from 'pocketbase';
import dotenv from 'dotenv';
dotenv.config();

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
try {
    const summary = await summarizeTicketMessages("c3oi15w89jl52t3");
    console.log(summary);
} catch (error) {
    console.error("Error:", error);
}