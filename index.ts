import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { createGroq } from '@ai-sdk/groq';
import { convertToModelMessages, streamText, type UIMessage } from 'ai';

const app = new Hono();

app.post('/api/chat', async (c) => {
  if (!process.env.GROQ_API_KEY) {
    return c.json({ error: 'Add GROQ_API_KEY to .env to enable chat.' }, 503);
  }
  try {
    const body = await c.req.json();
    if (!Array.isArray(body.messages) || !['users', 'workers'].includes(body.audience)) {
      return c.json({ error: 'Invalid chat request.' }, 400);
    }
    const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
    const result = streamText({
      model: groq(process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'),
      system: `You are GridGuide, a helpful electricity outage assistant for ${body.audience === 'workers' ? 'utility workers' : 'residential customers'}. This is a chat-only prototype. You have NO access to live outage data, locations, predictions, accounts, work orders, or report submission tools. Never claim to check an outage, predict whether an address will be affected, submit a report, or dispatch a crew. Explain these limitations when relevant and offer general guidance. For downed lines, advise staying away and contacting emergency services and the utility. Keep responses concise and helpful.`,
      messages: await convertToModelMessages(body.messages as UIMessage[]),
      abortSignal: c.req.raw.signal,
    });
    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error('Chat request failed:', error);
    return c.json({ error: 'Unable to start chat. Please try again.' }, 500);
  }
});

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));
if (process.env.NODE_ENV === 'production') {
  app.use('/*', serveStatic({ root: './dist' }));
  app.get('*', serveStatic({ path: './dist/index.html' }));
}

export default { port: Number(process.env.PORT || 3001), fetch: app.fetch };
