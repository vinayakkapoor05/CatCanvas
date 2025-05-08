const API_BASE    = "http://localhost:8000";  
const API_TOKEN   = "dummy_user";           
const TOP_K       = 5;

window.addEventListener('DOMContentLoaded', () => {
  const getEl = id => {
    const el = document.getElementById(id);
    if (!el) console.warn(`⚠️ Element #${id} not found.`);
    return el;
  };

  const scrapeUploadBtn = getEl('setupScrapeUploadBtn');
  const connectCalendarBtn = getEl('setupConnectCalendarBtn');
  const continueBtn = getEl('continueToAppBtn');
  const statusInd = getEl('setupStatusIndicator');
  const canvasStatus = getEl('canvasStatus');
  const calendarStatus = getEl('calendarStatus');
  const setupComplete = getEl('setupComplete');
  const step1 = getEl('step1');
  const step2 = getEl('step2');
  const darkToggle = getEl('dark-mode-toggle');

  const isSetupComplete = localStorage.getItem('setupComplete') === 'true';
  const isCanvasImported = localStorage.getItem('canvasImported') === 'true';
  const isCalendarConnected = localStorage.getItem('calendarConnected') === 'true';

  if (darkToggle) {
    const body = document.body;
    if (localStorage.getItem('darkMode') === 'true') {
      body.classList.add('dark-mode');
      darkToggle.checked = true;
    }
    darkToggle.addEventListener('change', () => {
      if (darkToggle.checked) {
        body.classList.add('dark-mode');
        localStorage.setItem('darkMode', 'true');
      } else {
        body.classList.remove('dark-mode');
        localStorage.setItem('darkMode', 'false');
      }
    });
  }

  const setStatus = txt => statusInd && (statusInd.textContent = txt);
  const setCanvasStatus = (txt, isSuccess = false, isError = false) => {
    if (canvasStatus) {
      canvasStatus.textContent = txt;
      canvasStatus.className = 'step-status';
      if (isSuccess) canvasStatus.classList.add('success');
      if (isError) canvasStatus.classList.add('error');
    }
  };
  const setCalendarStatus = (txt, isSuccess = false, isError = false) => {
    if (calendarStatus) {
      calendarStatus.textContent = txt;
      calendarStatus.className = 'step-status';
      if (isSuccess) calendarStatus.classList.add('success');
      if (isError) calendarStatus.classList.add('error');
    }
  };

  if (isSetupComplete) {
    window.location.href = 'sidepanel.html';
    return;
  }

  if (isCanvasImported) {
    step1.classList.add('completed');
    setCanvasStatus('Canvas data imported successfully!', true);
  }
  
  if (isCalendarConnected) {
    step2.classList.add('completed');
    setCalendarStatus('Google Calendar connected!', true);
  }

  const checkSetupComplete = () => {
    if (localStorage.getItem('canvasImported') === 'true' && 
        localStorage.getItem('calendarConnected') === 'true') {
      setupComplete.classList.remove('hidden');
    }
  };

  checkSetupComplete();

  if (scrapeUploadBtn) {
    scrapeUploadBtn.addEventListener('click', async () => {
      setStatus('Scraping Canvas content...');
      setCanvasStatus('Scraping in progress...');
      
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
          setCanvasStatus('Error: No Canvas data found', false, true);
          return;
        }
        
        window.canvasCache = docs;
        setStatus('Scraped courses. Uploading data...');
        setCanvasStatus('Importing data...');

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
          setCanvasStatus('Building index...');

          const buildRes = await fetch(`${API_BASE}/api/rag/build`, {
            method: 'POST', mode: 'cors',
            headers: {
              'Authorization': `Bearer ${API_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ overwrite: true })
          });
          
          const buildJson = await buildRes.json();
          const successMessage = buildJson.status === 'rebuilt' 
            ? `Index rebuilt: ${buildJson.documents_indexed} docs ready.`
            : `Build skipped: ${buildJson.reason}`;
          
          setStatus(successMessage);
          setCanvasStatus('Canvas data imported successfully!', true);
          
          step1.classList.add('completed');
          localStorage.setItem('canvasImported', 'true');
          
          checkSetupComplete();
          
        } catch (err) {
          console.error(err);
          setStatus('Upload error: ' + err.message);
          setCanvasStatus('Error uploading data: ' + err.message, false, true);
        }
      } catch (err) {
        console.error(err);
        setStatus('Scrape error: ' + err.message);
        setCanvasStatus('Error scraping Canvas: ' + err.message, false, true);
      }
    });
  }

  if (connectCalendarBtn) {
    connectCalendarBtn.addEventListener('click', async () => {
      setStatus('Opening Google sign-in...');
      setCalendarStatus('Connecting...');
      
      try {
        const res = await fetch(`${API_BASE}/oauth2init`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${API_TOKEN}` }
        });
        
        const { auth_url } = await res.json();
        window.open(auth_url, '_blank', 'width=500,height=600');
        setStatus('Waiting for you to grant access...');
        setCalendarStatus('Waiting for authorization...');
  
        const poll = setInterval(async () => {
          try {
            const s = await fetch(`${API_BASE}/oauth2status`, {
              headers: { 'Authorization': `Bearer ${API_TOKEN}` }
            });
            
            const { connected } = await s.json();
            if (connected) {
              clearInterval(poll);
              setStatus('✅ Google Calendar connected!');
              setCalendarStatus('Google Calendar connected!', true);
              
              step2.classList.add('completed');
              localStorage.setItem('calendarConnected', 'true');
              
              checkSetupComplete();
            }
          } catch (err) {
          }
        }, 2000);
  
      } catch (err) {
        console.error(err);
        setStatus('Connect error: ' + err.message);
        setCalendarStatus('Error connecting calendar: ' + err.message, false, true);
      }
    });
  }

  if (continueBtn) {
    continueBtn.addEventListener('click', () => {
      localStorage.setItem('setupComplete', 'true');
      window.location.href = 'sidepanel.html';
    });
  }
});