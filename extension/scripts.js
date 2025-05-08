const API_BASE    = "http://localhost:8000";  
const API_TOKEN   = "dummy_user";           
const TOP_K       = 5;

window.addEventListener('DOMContentLoaded', () => {
  const getEl = id => {
    const el = document.getElementById(id);
    if (!el) console.warn(`⚠️ Element #${id} not found.`);
    return el;
  };

  const scrapeBtn   = getEl('scrapeAllButton');
  const uploadBtn   = getEl('uploadBtn');
  const queryBtn    = getEl('queryBtn');
  const promptInput = getEl('userPrompt');
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      queryBtn.click();
    }
  });
  
  const responseDiv = getEl('response');
  const statusInd   = getEl('statusIndicator');
  const darkToggle  = getEl('dark-mode-toggle');
  const connectBtn = getEl('connectCalendar');


  if (darkToggle) {
    const body = document.body;
    if (localStorage.getItem('darkMode') === 'true') {
      body.classList.add('dark-mode');
      darkToggle.checked = true;
    }
    darkToggle.addEventListener('change', () => {
      if (darkToggle.checked) {
        body.classList.add('dark-mode');
        localStorage.setItem('darkMode','true');
      } else {
        body.classList.remove('dark-mode');
        localStorage.setItem('darkMode','false');
      }
    });
  }

  const setStatus   = txt => statusInd   && (statusInd.textContent   = txt);
  const setResponse = txt => responseDiv && (responseDiv.textContent = txt);

  if (scrapeBtn) {
    scrapeBtn.addEventListener('click', async () => {
      setStatus('Scraping Canvas content...');
      setResponse('');
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error('Active tab not found');

        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: async () => {
            function cleanText(text) {
              return text.replace(/\s+/g, ' ').trim();
            }
            function getCourseIds() {
              return Array.from(document.getElementsByClassName('ic-DashboardCard__link'))
                .map(el => el.href.match(/\/courses\/(\d+)/)?.[1])
                .filter(Boolean);
            }
            async function getCourseInfo(courseId) {
              try {
                const res = await fetch(`/api/v1/courses/${courseId}`, { credentials: 'include' });
                if (!res.ok) return { id: courseId, name: courseId, code: '' };
                const course = await res.json();
                return { id: courseId, name: course.name || courseId, code: course.course_code || '' };
              } catch {
                return { id: courseId, name: courseId, code: '' };
              }
            }
            async function getAllPagesText(courseId) {
              const results = {};
              const parser = new DOMParser();
              const listRes = await fetch(`/api/v1/courses/${courseId}/pages?per_page=100`, { credentials: 'include' });
              if (!listRes.ok) return results;
              const pages = await listRes.json();
              for (const page of pages) {
                const slug = page.url;
                try {
                  const pageRes = await fetch(
                    `/api/v1/courses/${courseId}/pages/${encodeURIComponent(slug)}`,
                    { credentials: 'include' }
                  );
                  if (!pageRes.ok) { results[slug] = '(fetch failed)'; continue; }
                  const pageData = await pageRes.json();
                  const doc = parser.parseFromString(pageData.body || '', 'text/html');
                  results[slug] = cleanText(doc.body.innerText);
                } catch {
                  results[slug] = '(error)';
                }
              }
              return results;
            }
            
            async function getSyllabusText(courseId) {
              try {
                const res = await fetch(`/courses/${courseId}/assignments/syllabus`, { credentials: 'include' });
                const html = await res.text();
                const doc = new DOMParser().parseFromString(html, 'text/html');
                return cleanText(doc.body.innerText);
              } catch {
                return '(syllabus fetch failed)';
              }
            }
            const courseIds = getCourseIds();
            const all = {};
            for (const id of courseIds) {
              const info = await getCourseInfo(id);
              const pages = await getAllPagesText(id);
              const syllabus = await getSyllabusText(id);
              all[id] = { info, pages, syllabus };
            }
            return all;
          }
        });

        const docs = results[0]?.result;
        if (!docs || typeof docs !== 'object') {
          setStatus('Error: No Canvas data returned.');
          return;
        }
        window.canvasCache = docs;
        setStatus(`Scraped ${Object.keys(docs).length} courses. Ready to upload.`);

      } catch (err) {
        console.error(err);
        setStatus('Scrape error: ' + err.message);
      }
    });
  }

  if (uploadBtn) {
    uploadBtn.addEventListener('click', async () => {
      if (!window.canvasCache) {
        setStatus('No data to upload. Please scrape first.');
        return;
      }
      setStatus('Uploading scraped data…');
      try {
        const res = await fetch(`${API_BASE}/api/rag/upload`, {
          method: 'POST', mode: 'cors',
          headers: {
            'Authorization': `Bearer ${API_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ docs: window.canvasCache })
        });
        const up = await res.json();
        if (!res.ok) throw new Error(up.detail || 'Upload failed');
        setStatus(`Indexed ${up.indexed} docs. Rebuilding index…`);

        const buildRes = await fetch(`${API_BASE}/api/rag/build`, {
          method: 'POST', mode: 'cors',
          headers: {
            'Authorization': `Bearer ${API_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ overwrite: true })
        });
        const buildJson = await buildRes.json();
        setStatus(
          buildJson.status === 'rebuilt'
            ? `Index rebuilt: ${buildJson.documents_indexed} docs ready.`
            : `Build skipped: ${buildJson.reason}`
        );
      } catch (err) {
        console.error(err);
        setStatus('Upload error: ' + err.message);
      }
    });
  }

  queryBtn.addEventListener('click', async () => {
    const prompt = promptInput.value.trim();
    if (!prompt) return setStatus('Please enter a question.');
    promptInput.value = '';

    setStatus('Querying server…');
    
    responseDiv.textContent = '';
    
    const res = await fetch(`${API_BASE}/api/rag/chat`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: prompt, top_k: TOP_K })
    });
  
    if (!res.ok) {
      setStatus(`Error ${res.status}`);
      responseDiv.textContent = await res.text();
      return;
    }
  
    setStatus('Streaming response…');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let done = false;
  
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      done = streamDone;
      if (value) {
        responseDiv.textContent += decoder.decode(value);
      }
    }
  
    setStatus('Response complete');
  });
  
  const syncBtn = getEl('syncSyllabus');
if (syncBtn) {
  syncBtn.addEventListener('click', async () => {
    setStatus('Syncing deadlines…');
    try {
      const res = await fetch(`${API_BASE}/api/rag/deadlines`, {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || 'Sync failed');
      setStatus('Deadlines received');
      console.log('Deadlines:', json.deadlines);
    } catch (err) {
      console.error(err);
      setStatus('Sync error: ' + err.message);
    }
  });
}
if (connectBtn) {
    connectBtn.addEventListener('click', async () => {
      setStatus('Opening Google sign-in…');
      try {
        const res = await fetch(`${API_BASE}/oauth2init`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${API_TOKEN}` }
        });
        const { auth_url } = await res.json();
        window.open(auth_url, '_blank', 'width=500,height=600');
        setStatus('Waiting for you to grant access…');
  
        const poll = setInterval(async () => {
          try {
            const s = await fetch(`${API_BASE}/oauth2status`, {
              headers: { 'Authorization': `Bearer ${API_TOKEN}` }
            });
            const { connected } = await s.json();
            if (connected) {
              clearInterval(poll);
              setStatus('✅ Google Calendar connected!');
            }
          } catch {
          }
        }, 2000);
  
      } catch (err) {
        console.error(err);
        setStatus('Connect error: ' + err.message);
      }
    });
  }
  
});