// popup.js - Scrape Canvas content and save to local file

// === Storage ===
let canvasCache = "";

// === Utility ===
function cleanText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function downloadToFile(content, filename = "canvas_content.txt") {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
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
    if (!results[0]?.result || typeof results[0].result !== "object") {
      out.textContent = "Error scraping.";
      return;
    }
    const data = results[0].result;
    canvasCache = Object.entries(data)
      .flatMap(([cid, pages]) => Object.entries(pages)
        .map(([slug, txt]) => `=== ${cid} / ${slug} ===\n${cleanText(txt)}\n`))
      .join("\n");

    // Trigger file download
    downloadToFile(canvasCache);

    out.textContent = "Scraped and saved to file successfully.";
  });
});
