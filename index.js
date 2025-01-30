import express from 'express';
import { config } from 'dotenv';
import { ChatOpenAI } from '@langchain/openai';
import { PineconeStore } from '@langchain/pinecone';
import { OpenAIEmbeddings } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { Pinecone } from '@pinecone-database/pinecone';
import cors from 'cors';

// Load environment variables
config();

const app = express();
app.use(express.json());

// CORS configuration
const corsOptions = {
  origin: ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:4200', 'https://chatgenius-prompt-server-project2.fly.dev', 'https://chatgenius-project2-final.netlify.app'], // Added port 4200
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true // Enable if you're using cookies/sessions
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Initialize OpenAI embeddings
const embeddings = new OpenAIEmbeddings({
    modelName: "text-embedding-3-large"
});

// Initialize Pinecone client
const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
    
});

// Get the index
const index = pinecone.Index(process.env.PINECONE_INDEX);

// Initialize Pinecone vector store (updated initialization)
const vectorStore = await PineconeStore.fromExistingIndex(
    embeddings,
    { pineconeIndex: index }
);

// Initialize ChatOpenAI
const llm = new ChatOpenAI({
    temperature: 0.7,
    modelName: "gpt-4",
});

// Create prompt template
const template = new PromptTemplate({
    template: "{query} Context: {context}",
    inputVariables: ["query", "context"]
});

app.post('/query', async (req, res) => {
    try {
        const { prompt } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        // Get relevant documents from Pinecone
        const context = await vectorStore.similaritySearch(prompt);

        // Format context for display
        const contextInfo = context.map(doc => ({
            source: doc.metadata,
            content: doc.pageContent
        }));

        // Create prompt with context
        const promptWithContext = await template.format({
            query: prompt,
            context: JSON.stringify(context)
        });

        // Get response from LLM
        const result = await llm.invoke(promptWithContext);

        res.json({
            context: contextInfo,
            response: result.content
        });

    } catch (error) {
        console.error('Error processing query:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
