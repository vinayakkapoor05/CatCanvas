/* popup.js - Combined with recursive summarization */

// === Configuration ===
const API_ENDPOINT = "https://api.together.xyz/v1/chat/completions";
const API_KEY = "099633d81272759e4e4d20f0ad1e56aaaca580def1370a8777edf222d5bc4cc1"; // consider moving to secure storage

// === Storage ===
let canvasCache = ""; // Store scraped and cleaned text

// === Recursive Summarization Utilities ===

/**
 * Split a large text into chunks under maxChars, ideally on sentence boundaries.
 */
function chunkText(text, maxChars = 15000) {
  const sentences = text.match(/[^.!?]+[.!?]+\s*/g) || [text];
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    if ((current + sentence).length > maxChars) {
      if (current) { chunks.push(current.trim()); current = ''; }
      if (sentence.length > maxChars) {
        for (let i = 0; i < sentence.length; i += maxChars) {
          chunks.push(sentence.slice(i, i + maxChars));
        }
      } else {
        current = sentence;
      }
    } else {
      current += sentence;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

/**
 * Summarize a single chunk via LLM.
 */
async function summarizeChunk(chunk) {
  const systemPrompt = "You are a helpful assistant that concisely summarizes text.";
  const userPrompt = `Please provide a concise summary of the following content:\n\n${chunk}`;

  const res = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "mistralai/Mixtral-8x7B-Instruct-v0.1",
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 1024
    })
  });

  if (!res.ok) throw new Error(`Summarization API error: ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

/**
 * Recursively summarize text until under maxChars.
 */
async function recursiveSummarize(text, maxChars = 15000) {
  if (text.length <= maxChars) return text;
  const chunks = chunkText(text, maxChars);
  const summaries = [];

  for (const chunk of chunks) {
    const summary = await summarizeChunk(chunk);
    summaries.push(summary);
  }

  const combined = summaries.join('\n');
  return combined.length > maxChars
    ? await recursiveSummarize(combined, maxChars)
    : combined;
}

// === Clean Text Utility ===
function cleanText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

// === Scrape Canvas Content ===
document.getElementById("scrapeAllButton").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const out = document.getElementById("response");
  out.textContent = "Scraping in progress...";

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async () => {
      function getcoursenums() {
        return Array.from(document.getElementsByClassName("ic-DashboardCard__link"))
          .map(el => el.href.split("/").pop())
          .filter(id => id);
      }
      async function getAllPagesText(courseId) {
        const results = {};
        const parser = new DOMParser();
        const listRes = await fetch(`/api/v1/courses/${courseId}/pages?per_page=100`, { credentials: "include" });
        if (!listRes.ok) return results;
        const pages = await listRes.json();
        for (const page of pages) {
          const slug = page.url;
          try {
            const pageRes = await fetch(`/api/v1/courses/${courseId}/pages/${encodeURIComponent(slug)}`, { credentials: "include" });
            if (!pageRes.ok) { results[slug] = "(fetch failed)"; continue; }
            const pageData = await pageRes.json();
            const doc = parser.parseFromString(pageData.body || "", "text/html");
            results[slug] = doc.body.innerText.trim();
          } catch { results[slug] = "(error)"; }
        }
        return results;
      }
      async function getsyllabuspagetext(courseid) {
        try {
          const res = await fetch(`/courses/${courseid}/assignments/syllabus`, { credentials: 'include' });
          const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
          return doc.body.innerText;
        } catch { return "(syllabus fetch failed)"; }
      }

      const courseIds = getcoursenums();
      const all = {};
      for (const id of courseIds) {
        const pageText = await getAllPagesText(id);
        const syllabus = await getsyllabuspagetext(id);
        all[id] = { ...pageText, syllabus };
      }
      return all;
    }
  }, (results) => {
    const out = document.getElementById("response");
    if (!results[0]?.result || typeof results[0].result !== "object") {
      out.textContent = "Error scraping.";
      return;
    }
    const data = results[0].result;
    canvasCache = Object.entries(data)
      .flatMap(([cid, pages]) => Object.entries(pages)
        .map(([slug, txt]) => `=== ${cid} / ${slug} ===\n${cleanText(txt)}\n`))
      .join("\n");
    out.textContent = "Scraped and cached successfully!";
    document.getElementById("cleanedText").innerText = canvasCache;
  });
});

// === Query with Recursive Summarization ===
document.getElementById("queryBtn").addEventListener("click", async () => {
  const prompt = document.getElementById("userPrompt").value;
  const responseDiv = document.getElementById("response");
  if (!canvasCache) {
    return responseDiv.innerText = "No Canvas data cached. Please scrape first.";
  }
  responseDiv.innerText = "Summarizing content and querying...";
  try {
    const summaryContext = await recursiveSummarize(canvasCache);
    const result = await queryLLM(prompt, summaryContext);
    responseDiv.innerText = result;
  } catch (err) {
    console.error(err);
    responseDiv.innerText = `Error during summarization/query: ${err.message}`;
  }
});

// === LLM Query Function ===
async function queryLLM(prompt, contextText) {
  const res = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "mistralai/Mixtral-8x7B-Instruct-v0.1",
      messages: [
        { role: 'system', content: "You are a helpful assistant that answers questions based on Canvas content." },
        { role: 'user', content: `Course content (summarized):\n${contextText}\n\nPrompt:\n${prompt}` }
      ],
      temperature: 0.3,
      max_tokens: 1024
    })
  });
  if (!res.ok) {
    const text = await res.text();
    return `API Error: ${res.status} — ${text}`;
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "Unexpected API response.";
}
