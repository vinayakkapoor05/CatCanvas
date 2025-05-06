// === Configuration ===

// === DOM Elements ===
const scrapeButton = document.getElementById("scrapeAllButton");
const queryButton = document.getElementById("queryBtn");
const promptInput = document.getElementById("userPrompt");
const responseDiv = document.getElementById("response");
const statusIndicator = document.getElementById("statusIndicator");

// === Dark Mode ===
document.addEventListener('DOMContentLoaded', function() {
  const darkModeToggle = document.getElementById('dark-mode-toggle');
  const body = document.body;
  
  // Check for saved user preference
  const savedDarkMode = localStorage.getItem('darkMode') === 'true';
  
  // Apply saved preference if it exists
  if (savedDarkMode) {
    body.classList.add('dark-mode');
    darkModeToggle.checked = true;
  }
  
  // Toggle dark mode on switch change
  darkModeToggle.addEventListener('change', function() {
    if (this.checked) {
      body.classList.add('dark-mode');
      localStorage.setItem('darkMode', 'true');
    } else {
      body.classList.remove('dark-mode');
      localStorage.setItem('darkMode', 'false');
    }
  });
});

// === Storage ===
let canvasCache = ""; // Store scraped and cleaned text

// === Helper Functions ===
function setStatus(text) {
  statusIndicator.textContent = text;
}

function setResponse(text) {
  responseDiv.textContent = text;
}

// === Recursive Summarization Utilities ===
// Split a large text into chunks under maxChars, ideally on sentence boundaries.
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


// Summarize a single chunk via LLM.
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
    setStatus(`Summarizing chunk ${summaries.length + 1}/${chunks.length}...`);
    const summary = await summarizeChunk(chunk);
    summaries.push(summary);
  }

  const combined = summaries.join('\n');
  
  if (combined.length > maxChars) {
    setStatus("Performing deeper summarization...");
    return await recursiveSummarize(combined, maxChars);
  }
  
  return combined;
}

// === Clean Text Utility ===
function cleanText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

// === Scrape Canvas Content ===
scrapeButton.addEventListener("click", async () => {
  setStatus("Preparing to scrape...");
  setResponse("");
  
  try {
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setStatus("Error: Cannot access current tab");
      return;
    }
    
    setStatus("Scraping Canvas content...");
    
    // Execute content script to scrape Canvas
    const results = await chrome.scripting.executeScript({
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
          try {
            const listRes = await fetch(`/api/v1/courses/${courseId}/pages?per_page=100`, { credentials: "include" });
            if (!listRes.ok) return results;
            
            const pages = await listRes.json();
            for (const page of pages) {
              const slug = page.url;
              try {
                const pageRes = await fetch(`/api/v1/courses/${courseId}/pages/${encodeURIComponent(slug)}`, { credentials: "include" });
                if (!pageRes.ok) { 
                  results[slug] = "(fetch failed)"; 
                  continue; 
                }
                
                const pageData = await pageRes.json();
                const doc = parser.parseFromString(pageData.body || "", "text/html");
                results[slug] = doc.body.innerText.trim();
              } catch { 
                results[slug] = "(error)"; 
              }
            }
          } catch (e) {
            console.error("Error fetching pages:", e);
          }
          return results;
        }
        
        async function getsyllabuspagetext(courseid) {
          try {
            const res = await fetch(`/courses/${courseid}/assignments/syllabus`, { credentials: 'include' });
            const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
            return doc.body.innerText;
          } catch { 
            return "(syllabus fetch failed)"; 
          }
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
    });
    
    if (!results || !results[0]?.result || typeof results[0].result !== "object") {
      setStatus("Error: Failed to scrape Canvas content");
      return;
    }
    
    const data = results[0].result;
    
    // Process and cache the scraped data
    canvasCache = Object.entries(data)
      .flatMap(([cid, pages]) => Object.entries(pages)
        .map(([slug, txt]) => `=== ${cid} / ${slug} ===\n${cleanText(txt)}\n`))
      .join("\n");
    
    // Save to chrome storage for persistence
    chrome.storage.local.set({ canvasData: canvasCache }, () => {
      if (chrome.runtime.lastError) {
        setStatus("Error saving data: " + chrome.runtime.lastError.message);
      } else {
        setStatus("Scraping complete! Retrieved data from " + Object.keys(data).length + " courses");
      }
    });
    
  } catch (error) {
    console.error("Scraping error:", error);
    setStatus("Error: " + error.message);
  }
});

// === Load cached data on startup ===
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get('canvasData', (result) => {
    if (result.canvasData) {
      canvasCache = result.canvasData;
      setStatus("Loaded previously scraped Canvas data");
    } else {
      setStatus("No Canvas data found. Click 'Scrape Canvas' to begin.");
    }
  });
});

// === Query with Recursive Summarization ===
queryButton.addEventListener("click", async () => {
  const prompt = promptInput.value.trim();
  
  if (!prompt) {
    setStatus("Please enter a question");
    return;
  }
  
  if (!canvasCache) {
    setStatus("No Canvas data cached. Please scrape first.");
    return;
  }
  
  try {
    setStatus("Processing Canvas content...");
    setResponse("Working on your question...");
    
    // Summarize content for context
    const summaryContext = await recursiveSummarize(canvasCache);
    
    setStatus("Querying AI with your question...");
    const result = await queryLLM(prompt, summaryContext);
    
    setResponse(result);
    setStatus("Response ready");
  } catch (err) {
    console.error("Query error:", err);
    setStatus("Error: " + err.message);
    setResponse("An error occurred while processing your question. Please try again.");
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
        { role: 'system', content: "You are a helpful assistant that answers questions based on Canvas course content." },
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