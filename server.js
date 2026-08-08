require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());

// In-Memory Storage
let activeAgent = null;
let posts = [];

// Gemini Setup
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// -------------------------------------------------------------
// 1. ENDPOINT: Initialize Agent (POST /api/agent/init)
// -------------------------------------------------------------
app.post('/api/agent/init', (req, res) => {
  const { persona } = req.body || {};
  
  const agentId = `agent-${Date.now()}`;
  activeAgent = {
    agentId,
    name: persona?.name || 'Ada',
    domain: persona?.domain || 'AI Security'
  };

  // Run the first cycle immediately
  runAgentCycle(activeAgent);

  // Set background timer to run every 1 hour autonomously
  setInterval(() => {
    runAgentCycle(activeAgent);
  }, 60 * 60 * 1000);

  console.log(`[Agent] Initialized with ID: ${agentId}`);
  return res.json({ agentId });
});

// -------------------------------------------------------------
// 2. ENDPOINT: Retrieve Feed (GET /api/agent/feed)
// -------------------------------------------------------------
app.get('/api/agent/feed', (req, res) => {
  const { agentId } = req.query;

  if (!activeAgent || activeAgent.agentId !== agentId) {
    return res.status(404).json({ error: 'Agent not initialized or ID invalid' });
  }

  // Reverse chronological order (newest first)
  const sortedPosts = [...posts].reverse();
  return res.json({ posts: sortedPosts });
});

// -------------------------------------------------------------
// 3. AUTONOMOUS CYCLE FUNCTION
// -------------------------------------------------------------
async function runAgentCycle(persona) {
  try {
    console.log(`[Autonomous Agent] Starting discovery cycle for ${persona.name}...`);

    // A. Discover Topics from Live Source (HackerNews Top Stories)
    const topStoryIdsRes = await axios.get('https://hacker-news.firebaseio.com/v0/topstories.json');
    const topStoryIds = topStoryIdsRes.data.slice(0, 5);

    const stories = await Promise.all(
      topStoryIds.map(async (id) => {
        const item = await axios.get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        return {
          title: item.data.title,
          url: item.data.url || `https://news.ycombinator.com/item?id=${id}`
        };
      })
    );

    // B. Send News & Past Posts Memory to Gemini for Editorial Evaluation
    const pastPostsSummary = posts.map(p => `- ${p.text}`).join('\n');

    const prompt = `
      You are an autonomous AI tech persona named ${persona.name}, specializing in ${persona.domain}.
      
      Here are past posts you have already published:
      ${pastPostsSummary || 'None so far.'}

      Here are live stories discovered right now:
      ${JSON.stringify(stories, null, 2)}

      Your Task:
      1. Review the stories. Pick ONE story that strongly relates to ${persona.domain}.
      2. Demonstrate editorial judgment: If no story is high quality or relevant, or if it repeats past topics, DO NOT publish.
      3. If a story is worth publishing, write a post in your distinct persona voice.

      Return ONLY a JSON object (no markdown, no backticks) formatted like this:
      {
        "shouldPublish": true,
        "text": "Your post text in your editorial voice.",
        "rationale": "Why this topic was selected, why relevant now, and why chosen over other candidates.",
        "source": "URL of the chosen story"
      }

      If you decide NOT to publish, return:
      { "shouldPublish": false }
    `;

    const result = await model.generateContent(prompt);
    const cleanJsonText = result.response.text().replace(/```json|```/g, '').trim();
    const evaluation = JSON.parse(cleanJsonText);

    // C. Save Post if Approved
    if (evaluation.shouldPublish) {
      const newPost = {
        id: `p${posts.length + 1}`,
        createdAt: new Date().toISOString(),
        text: evaluation.text,
        rationale: evaluation.rationale,
        sources: [evaluation.source]
      };
      posts.push(newPost);
      console.log(`[Autonomous Agent] Published post ${newPost.id}`);
    } else {
      console.log(`[Autonomous Agent] Topics evaluated but rejected by editorial judgment.`);
    }

  } catch (err) {
    console.error('[Autonomous Agent Error]', err.message);
  }
}

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});