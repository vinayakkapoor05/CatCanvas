const API_BASE    = "http://localhost:8000";
const API_TOKEN   = "dummy_user";
const TOP_K       = 5;

window.addEventListener('DOMContentLoaded', () => {
  
  // —— TAB SWITCHING (unchanged) ——
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');
  const inputContainer = document.querySelector('.input-container');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.dataset.tab;
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      tabContents.forEach(c => {
        c.id === tabId
          ? c.classList.add('active')
          : c.classList.remove('active');
      });
      if (tabId === 'infoTab') {
        inputContainer.classList.add('hidden');
      } else {
        inputContainer.classList.remove('hidden');
      }
        
    });
  });
    
  // —— SETUP CHECK (unchanged) ——
  if (localStorage.getItem('setupComplete') !== 'true') {
    window.location.href = 'setup.html';
    return;
  }

  // —— ELEMENT SHORTCUTS ——
  const getEl = id => {
    const el = document.getElementById(id);
    if (!el) console.warn(`⚠️ Element #${id} not found.`);
    return el;
  };
  
  // Chat tab elements
  const chatResponseDiv = getEl('response');
  const chatStatusInd = getEl('statusIndicator');
  const queryBtn = getEl('queryBtn');
  const promptInput = getEl('userPrompt');
  
  // 4-Year Plan tab elements
  const planTabContent = getEl('planTab');
  const scrapeCourseBtn = getEl('scrapeCourseButton');
  const planStatusInd = planTabContent ? planTabContent.querySelector('.status-indicator') : null;
  const planResponseDiv = planTabContent ? planTabContent.querySelector('.response-area') : null;
  
  // Common elements
  const darkToggle = getEl('dark-mode-toggle');
  const scrapeUploadBtn = getEl('scrapeUploadBtn');
  const connectBtn = getEl('connectCalendar');
  const addDeadlinesBtn = getEl('addDeadlines');

  // —— DARK MODE TOGGLE (unchanged) ——
  if (darkToggle) {
    if (localStorage.getItem('darkMode') === 'true') {
      document.body.classList.add('dark-mode');
      darkToggle.checked = true;
    }
    darkToggle.addEventListener('change', () => {
      if (darkToggle.checked) {
        document.body.classList.add('dark-mode');
        localStorage.setItem('darkMode','true');
      } else {
        document.body.classList.remove('dark-mode');
        localStorage.setItem('darkMode','false');
      }
    });
  }

  // —— STATUS / RESPONSE HELPERS (Tab-specific) ——
  const setChatStatus = txt => chatStatusInd && (chatStatusInd.textContent = txt);
  const setChatResponse = txt => chatResponseDiv && (chatResponseDiv.textContent = txt);
  const setPlanStatus = txt => planStatusInd && (planStatusInd.textContent = txt);
  const setPlanResponse = txt => planResponseDiv && (planResponseDiv.textContent = txt);

  // Generic status setter that uses the appropriate element based on the active tab
  const setStatus = txt => {
    const activePlanTab = planTabContent && planTabContent.classList.contains('active');
    if (activePlanTab) {
      setPlanStatus(txt);
    } else {
      setChatStatus(txt);
    }
  };

  // —— PROGRESS BAR INJECTION ——
  // Add progress bar to Plan tab

  
  // now sends into the status‐indicator div
  function updatePlanProgress(msg, pct) {
    if (planStatusInd) planStatusInd.textContent = msg;
  }
  
  // —— SCRAPE COURSES FLOW (Now uses Plan tab status) ——
  if (scrapeCourseBtn) {
    scrapeCourseBtn.addEventListener('click', scrapeCourses);
  }

  async function scrapeCourses() {
    updatePlanProgress("Starting to scrape courses...", 10);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.url.includes("canvas.northwestern.edu")) {
        updatePlanProgress("Error: Please navigate to Canvas first!", true);
        return;
      }

      updatePlanProgress("Checking current page...", 20);
      const [{ result: pageStatus }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: checkCurrentPage
      });

      if (!pageStatus.onCoursesPage) {
        updatePlanProgress("Navigating to courses page...", 30);
        const [{ result: navOk }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: navigateToCoursesPage
        });
        if (!navOk) {
          updatePlanProgress("Error: Could not find courses. Make sure you click 'Courses' in the left sidebar.", true);
          return;
        }
        updatePlanProgress("Waiting for page to load...", 35);
        await new Promise(r => setTimeout(r, 3000));
      }

      // now scrape
      updatePlanProgress("Scraping course data...", 60);
      const [{ result: data }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapeCourseData
      });
      if (!data || data.error) {
        updatePlanProgress(`Error: ${data?.error || 'No data returned.'}`, true);
        return;
      }

      updatePlanProgress("Processing scraped data...", 80);
      const total = (data.currentCourses?.length || 0) + (data.pastCourses?.length || 0);
      if (total === 0) {
        updatePlanProgress("No classes found. Make sure you're on the correct page.", true);
        return;
      }

      // const blob = new Blob([JSON.stringify({
      //   currentCourses: data.currentCourses,
      //   pastCourses:    data.pastCourses

      // }, null, 2)], { type: 'application/json' });
      // const url = URL.createObjectURL(blob);

      // updatePlanProgress("Saving data to file...", 90);

      // // plain-<a> download instead of chrome.downloads
      // const a = document.createElement('a');
      // a.href = url;
      // a.download = 'canvas_classes.json';
      // document.body.appendChild(a);
      // a.click();
      // document.body.removeChild(a);
      // URL.revokeObjectURL(url);
      
      // updatePlanUI(
      //   `Success! Scraped ${total} classes.\n` +
      //   `Current: ${data.currentCourses.length}, Past: ${data.pastCourses.length}\n\n` +
      //   `Saved to canvas_classes.json`
      // );
      // if (planProgressBar) {
      //   planProgressBar.style.display = 'none';
      // }
      
  updatePlanProgress("Uploading to Plan index…", 90);
  const blobData = {
    currentCourses: data.currentCourses,
    pastCourses:    data.pastCourses
  };
  
  const res = await fetch(`${API_BASE}/api/plan/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_TOKEN}`,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify({ courses: blobData })
  });
  if (!res.ok) {
    const err = await res.text();
    return updatePlanProgress("Upload error: " + err, true);
  }
  const j = await res.json();
  if (planStatusInd) planStatusInd.textContent = '';
  updatePlanProgress(`Success! Indexed ${j.indexed} document(s) for planning.`);

  

    } catch (err) {
      updatePlanProgress("Scrape error: " + err.message, true);
    }
  }

  // —— PAGE CHECK / NAV HELPERS ——
  function checkCurrentPage() {
    return {
      onCoursesPage:
        location.pathname.includes('/courses') &&
        (!!document.getElementById('my_courses_table') ||
         !!document.getElementById('past_enrollments_table'))
    };
  }
  function navigateToCoursesPage() {
    const btn = document.querySelector('button#global_nav_courses_link');
    if (btn) {
      btn.click();
      setTimeout(() => {
        const link = Array.from(document.querySelectorAll('a'))
          .find(a => a.textContent.includes('All Courses') && a.href.includes('/courses'));
        link?.click();
      }, 500);
      return true;
    }
    const fallback = Array.from(document.querySelectorAll('a'))
      .find(a => a.textContent.trim() === 'All Courses' && a.href.includes('/courses'));
    if (fallback) { fallback.click(); return true; }
    return false;
  }

  // —— DATA SCRAPER ——
  function scrapeCourseData() {
    try {
      const extract = (rows, type) => {
        return Array.from(rows).map(r => {
          const nameEl = r.querySelector('.course-list-course-title-column a .name');
          const linkEl = r.querySelector('.course-list-course-title-column a');
          const termEl = r.querySelector('.course-list-term-column');
          const asEl   = r.querySelector('.course-list-enrolled-as-column');
          const pubEl  = r.querySelector('.course-list-published-column');
          const idMatch = linkEl?.href.match(/\/courses\/(\d+)/);
          return {
            class_name:    nameEl?.textContent.trim() || 'Unknown',
            course_id:     idMatch?.[1] || null,
            term:          termEl?.textContent.trim() || 'Unknown',
            enrolled_as:   asEl?.textContent.trim() || 'Unknown',
            published:     pubEl?.textContent.includes('Yes'),
            enrollment_type: type
          };
        });
      };

      const currT = document.getElementById('my_courses_table');
      const pastT = document.getElementById('past_enrollments_table');
      const currentCourses = currT ? extract(currT.querySelectorAll('tbody tr'), 'Current') : [];
      const pastCourses    = pastT ? extract(pastT.querySelectorAll('tbody tr'), 'Past')    : [];

      return { currentCourses, pastCourses };
    } catch (e) {
      return { error: e.message };
    }
  }


  if (promptInput) {
    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        queryBtn.click();
      }
    });
  }
  
  async function checkCalendarConnection() {
    try {
      const s = await fetch(`${API_BASE}/oauth2status`, {
        headers: { 'Authorization': `Bearer ${API_TOKEN}` }
      });
      const { connected } = await s.json();
      
      if (!connected && localStorage.getItem('calendarConnected') === 'true') {
        localStorage.setItem('calendarConnected', 'false');
        alert('Your Google Calendar session has expired. Please reconnect.');
        window.location.href = 'setup.html';
      }
    } catch (err) {
      console.error('Error checking calendar connection:', err);
    }
  }

  checkCalendarConnection();

  if (scrapeUploadBtn) {
    scrapeUploadBtn.addEventListener('click', async () => {
      setChatStatus('Scraping Canvas content...');
      setChatResponse('');
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
              all[id] = { info, pages, syllabus};
            }
            return all;
          }
        });

        const docs = results[0]?.result;
        if (!docs || typeof docs !== 'object') {
          setChatStatus('Error: No Canvas data returned.');
          return;
        }
        window.canvasCache = docs;
        setChatStatus(`Scraped ${Object.keys(docs).length} courses. Uploading data...`);
        localStorage.setItem('canvasImported', 'true');

        await uploadScrapedData();

      } catch (err) {
        console.error(err);
        setChatStatus('Scrape error: ' + err.message);
      }
    });
  }

  async function uploadScrapedData() {
    if (!window.canvasCache) {
      setChatStatus('No data to upload. Please scrape first.');
      return;
    }
    setChatStatus('Uploading scraped data…');
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
      setChatStatus(`Indexed ${up.indexed} docs. Rebuilding index…`);

      const buildRes = await fetch(`${API_BASE}/api/rag/build`, {
        method: 'POST', mode: 'cors',
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ overwrite: true })
      });
      const buildJson = await buildRes.json();
      setChatStatus(
        buildJson.status === 'rebuilt'
          ? `Index rebuilt: ${buildJson.documents_indexed} docs ready.`
          : `Build skipped: ${buildJson.reason}`
      );
    } catch (err) {
      console.error(err);
      setChatStatus('Upload error: ' + err.message);
    }
  }

  if (queryBtn) {
    // queryBtn.addEventListener('click', async () => {
    //   const prompt = promptInput.value.trim();
    //   if (!prompt) return setChatStatus('Please enter a question.');
    //   promptInput.value = '';

    //   setChatStatus('Querying server…');
      
    //   chatResponseDiv.textContent = '';
      
    //   const res = await fetch(`${API_BASE}/api/rag/chat`, {
    //     method: 'POST',
    //     headers: {
    //       'Authorization': `Bearer ${API_TOKEN}`,
    //       'Content-Type': 'application/json'
    //     },
    //     body: JSON.stringify({ query: prompt, top_k: TOP_K })
    //   });
    
    //   if (!res.ok) {
    //     setChatStatus(`Error ${res.status}`);
    //     chatResponseDiv.textContent = await res.text();
    //     return;
    //   }
    
    //   setChatStatus('Streaming response…');
    //   const reader = res.body.getReader();
    //   const decoder = new TextDecoder();
    //   let done = false;
    
    //   while (!done) {
    //     const { value, done: streamDone } = await reader.read();
    //     done = streamDone;
    //     if (value) {
    //       chatResponseDiv.textContent += decoder.decode(value);
    //     }
    //   }
    
    //   setChatStatus('Response complete');
    // });
    queryBtn.addEventListener('click', async () => {
      const prompt = promptInput.value.trim();
      if (!prompt) return setStatus('Please enter a question.');
      promptInput.value = '';

      const isPlan = planTabContent.classList.contains('active');
      const endpoint = isPlan ? '/api/plan/chat' : '/api/rag/chat';
    
      // clear both status & the old response
      setStatus('');
      if (isPlan) setPlanResponse('');
      else        setChatResponse('');
    
      setStatus('Querying ' + (isPlan ? 'Plan' : 'Canvas') + ' server…');
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: prompt, top_k: TOP_K })
      });
    
      if (!res.ok) {
        setStatus(`Error ${res.status}`);
        const txt = await res.text();
        if (isPlan) setPlanResponse(txt);
        else        setChatResponse(txt);
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
          const chunk = decoder.decode(value);
          if (isPlan) setPlanResponse(planResponseDiv.textContent + chunk);
          else        setChatResponse(chatResponseDiv.textContent + chunk);
        }
      }
    
      setStatus('Response complete');
    });
      
  }
  
  if (addDeadlinesBtn) {
    addDeadlinesBtn.addEventListener('click', async () => {
      setChatStatus('Syncing deadlines…');
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
        setChatStatus('Deadlines Synced');
        console.log('Deadlines:', json.deadlines);
      } catch (err) {
        console.error(err);
        setChatStatus('Sync error: ' + err.message);
      }
    });
  }

  if (connectBtn) {
    connectBtn.addEventListener('click', async () => {
      setChatStatus('Opening Google sign-in…');
      try {
        const res = await fetch(`${API_BASE}/oauth2init`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${API_TOKEN}` }
        });
        const { auth_url } = await res.json();
        window.open(auth_url, '_blank', 'width=500,height=600');
        setChatStatus('Waiting for you to grant access…');
  
        const poll = setInterval(async () => {
          try {
            const s = await fetch(`${API_BASE}/oauth2status`, {
              headers: { 'Authorization': `Bearer ${API_TOKEN}` }
            });
            const { connected } = await s.json();
            if (connected) {
              clearInterval(poll);
              setChatStatus('Google Calendar connected!');
              localStorage.setItem('calendarConnected', 'true');
            }
          } catch {
          }
        }, 2000);
  
      } catch (err) {
        console.error(err);
        setChatStatus('Connect error: ' + err.message);
      }
    });
  }
  
});

document.addEventListener('DOMContentLoaded', () => {
  const infoToggle = document.getElementById('infoToggle');
  const infoBox = document.getElementById('infoBox');

  if (infoToggle && infoBox) {
    infoToggle.addEventListener('click', () => {
      infoBox.classList.toggle('hidden');
    });
  }
});
