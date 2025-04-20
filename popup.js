let canvasCache = ""; // Store scraped text

document.getElementById("scrapeAllButton").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const out = document.getElementById("response");
  out.textContent = "Scraping in progress...";

  chrome.scripting.executeScript(
    {
      target: { tabId: tab.id },
      func: async () => {
        function getcoursenums() {
          const els = document.getElementsByClassName("ic-DashboardCard__link");
          return Array.from(els)
            .map(el => {
              const parts = (el.href || "").split("/");
              return parts[parts.length - 1];
            })
            .filter(id => id);
        }

        async function getAllPagesText(courseId) {
          const results = {};
          const parser = new DOMParser();
          const listRes = await fetch(`/api/v1/courses/${courseId}/pages?per_page=100`, {
            credentials: "include",
            headers: { "Accept": "application/json" }
          });

          if (!listRes.ok) return results;
          const pages = await listRes.json();

          for (const page of pages) {
            const slug = page.url;
            try {
              const pageRes = await fetch(`/api/v1/courses/${courseId}/pages/${encodeURIComponent(slug)}`, {
                credentials: "include",
                headers: { "Accept": "application/json" }
              });

              if (!pageRes.ok) {
                results[slug] = "(fetch failed)";
                continue;
              }

              const pageData = await pageRes.json();
              const doc = parser.parseFromString(pageData.body || "", "text/html");
              results[slug] = doc.body.innerText.trim();
            } catch (err) {
              results[slug] = "(error)";
            }
          }

          return results;
        }

        async function getsyllabuspagetext(courseid) {
          const url = `/courses/${courseid}/assignments/syllabus`;
          try {
            const res = await fetch(url, { credentials: 'include' });
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
    },
    (results) => {
      const out = document.getElementById("response");
      if (!results || !results[0] || typeof results[0].result !== "object") {
        out.textContent = "Error scraping.";
        return;
      }
      const data = results[0].result;

      // Flatten and clean text before storing
      canvasCache = Object.entries(data)
        .flatMap(([cid, pages]) =>
          Object.entries(pages).map(
            ([slug, txt]) => `=== ${cid} / ${slug} ===\n${cleanText(txt)}\n`
          )
        )
        .join("\n");

      out.textContent = "Scraped and cached successfully!";
      
      // Show cleaned text in the popup div
      const cleanedText = Object.entries(data)
        .flatMap(([cid, pages]) =>
          Object.entries(pages).map(
            ([slug, txt]) => `=== ${cid} / ${slug} ===\n${cleanText(txt)}\n`
          )
        )
        .join("\n");

      // Log to console
      console.log("Cleaned Text:\n", cleanedText);

      // Display cleaned text in the popup div
      const cleanedTextDiv = document.getElementById("cleanedText");
      cleanedTextDiv.innerText = cleanedText;
    }
  );
});

document.getElementById("queryBtn").addEventListener("click", async () => {
  const prompt = document.getElementById("userPrompt").value;
  const responseDiv = document.getElementById("response");
  responseDiv.innerText = "Querying...";

  if (!canvasCache) {
    responseDiv.innerText = "No Canvas data cached. Please scrape first.";
    return;
  }

  const result = await queryLLM(prompt, canvasCache);
  responseDiv.innerText = result;
});

async function queryLLM(prompt, contextText) {
  try {
    const res = await fetch("https://api.together.xyz/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer 099633d81272759e4e4d20f0ad1e56aaaca580def1370a8777edf222d5bc4cc1",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "mistralai/Mixtral-8x7B-Instruct-v0.1",
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant that answers questions based on Canvas course content."
          },
          {
            role: "user",
            content: `Course content:\n${contextText}\n\nPrompt:\n${prompt}`
          }
        ],
        temperature: 0.3,
        max_tokens: 1024
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      return `API Error: ${res.status} — ${errorText}`;
    }

    const data = await res.json();
    if (!data || !data.choices || !data.choices.length) {
      return "Error: Unexpected response from API.";
    }

    return data.choices[0].message.content;
  } catch (err) {
    return `Query failed: ${err.message}`;
  }
}

function cleanText(text) {
  const clean = text
    .replace(/\s+/g, " ")       // Remove multiple spaces
    .replace(/^\s+|\s+$/g, ""); // Trim leading and trailing spaces
  return clean;
}
