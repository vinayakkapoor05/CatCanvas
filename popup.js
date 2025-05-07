// popup.js - Scrape Canvas content and download as ZIP with folders

// === Utility ===
function cleanText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9-_.]/gi, '_').toLowerCase();
}

async function downloadZip(zip) {
  const content = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(content);
  const link = document.createElement("a");
  link.href = url;
  link.download = `canvas-courses-${new Date().toISOString().slice(0,10)}.zip`;
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
          .map(el => {
            const matches = el.href.match(/\/courses\/(\d+)/);
            return matches ? matches[1] : null;
          })
          .filter(id => id);
      }

      async function getCourseInfo(courseId) {
        try {
          const res = await fetch(`/api/v1/courses/${courseId}`, { credentials: "include" });
          if (!res.ok) return { id: courseId, name: courseId };
          const course = await res.json();
          return {
            id: courseId,
            name: course.course_code || course.name || courseId,
            code: course.course_code || ""
          };
        } catch {
          return { id: courseId, name: courseId, code: "" };
        }
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
            if (!pageRes.ok) {
              results[slug] = {
                content: "(fetch failed)",
                title: slug,
                updated: new Date().toISOString()
              };
              continue;
            }
            const pageData = await pageRes.json();
            const doc = parser.parseFromString(pageData.body || "", "text/html");
            results[slug] = {
              content: doc.body.innerText.trim(),
              title: pageData.title || slug,
              updated: pageData.updated_at || new Date().toISOString()
            };
          } catch {
            results[slug] = {
              content: "(error)",
              title: slug,
              updated: new Date().toISOString()
            };
          }
        }
        return results;
      }

      async function getsyllabuspagetext(courseid) {
        try {
          const res = await fetch(`/courses/${courseid}/assignments/syllabus`, { credentials: 'include' });
          const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
          return {
            content: doc.body.innerText,
            title: "syllabus",
            updated: new Date().toISOString()
          };
        } catch {
          return {
            content: "(syllabus fetch failed)",
            title: "syllabus",
            updated: new Date().toISOString()
          };
        }
      }

      const courseIds = getcoursenums();
      const all = {};
      for (const id of courseIds) {
        const courseInfo = await getCourseInfo(id);
        const pageText = await getAllPagesText(id);
        const syllabus = await getsyllabuspagetext(id);
        all[id] = {
          ...courseInfo,
          pages: { ...pageText, syllabus }
        };
      }
      return all;
    }
  }, async (results) => {
    if (!results[0]?.result || typeof results[0].result !== "object") {
      out.textContent = "Error scraping.";
      return;
    }
    
    const data = results[0].result;
    const zip = new JSZip();
    let fileCount = 0;
    
    // Create folder structure in ZIP
    for (const [courseId, courseData] of Object.entries(data)) {
      const folderName = `${sanitizeFilename(courseData.code)}_${courseId}`;
      const courseFolder = zip.folder(folderName);
      
      for (const [pageName, pageData] of Object.entries(courseData.pages)) {
        const cleanedContent = cleanText(pageData.content);
        const cleanPageName = sanitizeFilename(pageData.title);
        const filename = `${cleanPageName}.txt`;
        
        courseFolder.file(filename, cleanedContent);
        fileCount++;
      }
    }
    
    out.textContent = `Packaging ${fileCount} files into ZIP...`;
    await downloadZip(zip);
    out.textContent = `Download complete! ${fileCount} files organized into course folders.`;
  });
});