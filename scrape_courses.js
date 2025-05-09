// DOM elements to show progress and response messages
const scrapeAllButton = document.getElementById('scrapeAllButton');
const scrapeCourseButton = document.getElementById('scrapeCourseButton');
const responseDiv = document.getElementById('response');
const progressBar = document.createElement('progress');
progressBar.style.width = '100%';
progressBar.style.display = 'none';
responseDiv.parentNode.insertBefore(progressBar, responseDiv.nextSibling);

// Response message handler
function updateResponse(message, isError = false, showProgress = false) {
  responseDiv.textContent = message;
  responseDiv.style.color = isError ? 'red' : 'black';
  progressBar.style.display = showProgress ? 'block' : 'none';
}

// Progress update handler
function updateProgress(message, percentage) {
  updateResponse(message, false, true);
  progressBar.value = percentage;
  progressBar.max = 100;
}

// Primary function to scrape courses from dashboard
function scrapeCourses() {
  updateProgress("Starting to scrape courses...", 10);

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab.url.includes("canvas.northwestern.edu")) {
      updateResponse("Error: Please navigate to Canvas first!", true);
      return;
    }

    updateProgress("Checking current page...", 20);

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: checkCurrentPage
    }, (results) => {
      if (chrome.runtime.lastError) {
        updateResponse("Error: " + chrome.runtime.lastError.message, true);
        return;
      }

      const { result: pageStatus } = results[0];

      if (pageStatus.onCoursesPage) {
        updateProgress("On courses page. Starting to scrape...", 40);
        executeScrapeCourses(tab.id);
      } else {
        updateProgress("Navigating to courses page...", 30);
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: navigateToCoursesPage
        }, (navResults) => {
          if (chrome.runtime.lastError) {
            updateResponse("Error: " + chrome.runtime.lastError.message, true);
            return;
          }

          if (navResults[0].result) {
            updateProgress("Successfully navigated. Waiting for page to load...", 35);
            setTimeout(() => {
              executeScrapeCourses(tab.id);
            }, 3000);
          } else {
            updateResponse("Error: Could not find courses navigation. Please try manually.", true);
          }
        });
      }
    });
  });
}

// Executes scraping of course data
function executeScrapeCourses(tabId) {
  updateProgress("Scraping course data...", 60);

  chrome.scripting.executeScript({
    target: { tabId: tabId },
    function: scrapeCourseData
  }, (results) => {
    if (chrome.runtime.lastError) {
      updateResponse("Error: " + chrome.runtime.lastError.message, true);
      return;
    }

    const data = results[0]?.result;
    if (!data) {
      updateResponse("Failed to retrieve class data. Please try again.", true);
      return;
    }

    if (data.error) {
      updateResponse(`Error: ${data.error}`, true);
      return;
    }

    updateProgress("Processing scraped data...", 80);

    const courseCount = (data.currentCourses?.length || 0) + (data.pastCourses?.length || 0);
    
    if (courseCount > 0) {
      const blob = new Blob(
        [JSON.stringify({
          current_classes: data.currentCourses || [],
          past_classes: data.pastCourses || []
        }, null, 2)],
        { type: 'application/json' }
      );
      const url = URL.createObjectURL(blob);

      updateProgress("Saving data to file...", 90);

      chrome.downloads.download({
        url: url,
        filename: 'taken_classes.json',
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          updateResponse(`Error saving file: ${chrome.runtime.lastError.message}`, true);
          URL.revokeObjectURL(url);
          return;
        }

        updateResponse(`Success! Scraped ${courseCount} classes total.\n\nCurrent courses: ${data.currentCourses?.length || 0}\nPast courses: ${data.pastCourses?.length || 0}\n\nSaved to canvas_classes.json`);
        progressBar.style.display = 'none';
        URL.revokeObjectURL(url);
      });
    } else {
      updateResponse("No classes found. Make sure you're on the correct page.", true);
    }
  });
}

// Checks if on the correct Canvas courses page
function checkCurrentPage() {
  return {
    onCoursesPage: window.location.pathname.includes('/courses') &&
                   (!!document.getElementById('my_courses_table') || 
                    !!document.getElementById('past_enrollments_table'))
  };
}

// Tries to navigate to the Canvas courses page
function navigateToCoursesPage() {
  // First try clicking the courses icon in the dashboard navigation
  const coursesNav = document.querySelector('button#global_nav_courses_link');
  if (coursesNav) {
    coursesNav.click();
    
    // Wait a bit for the dropdown to appear
    setTimeout(() => {
      // Try to click "All Courses"
      const allCoursesLink = [...document.querySelectorAll('a')].find(a => 
        a.textContent.includes('All Courses') && a.href.includes('/courses'));
      
      if (allCoursesLink) {
        allCoursesLink.click();
        return true;
      }
    }, 500);
    return true;
  }

  // As a fallback, look for any "All Courses" link
  const allCoursesLink = [...document.querySelectorAll('a')].find(a =>
    a.textContent.trim() === 'All Courses' && a.href.includes('/courses'));

  if (allCoursesLink) {
    allCoursesLink.click();
    return true;
  }

  return false;
}

// Extracts course data from both current and past enrollments tables
function scrapeCourseData() {
  try {
    // Helper function to extract courses from table rows
    function extractCoursesFromRows(rows, enrollmentType) {
      const courses = [];
      
      rows.forEach(row => {
        try {
          const nameEl = row.querySelector('.course-list-course-title-column a .name');
          const linkEl = row.querySelector('.course-list-course-title-column a');
          const termEl = row.querySelector('.course-list-term-column');
          const enrolledAsEl = row.querySelector('.course-list-enrolled-as-column');
          const publishedEl = row.querySelector('.course-list-published-column');
          
          const idMatch = linkEl?.href.match(/\/courses\/(\d+)/);
          const courseId = idMatch ? idMatch[1] : null;
          
          if (nameEl?.textContent.trim()) {
            courses.push({
              class_name: nameEl.textContent.trim(),
              course_id: courseId,
              term: termEl?.textContent.trim() || 'Unknown',
              enrolled_as: enrolledAsEl?.textContent.trim() || 'Unknown',
              published: publishedEl?.textContent.includes('Yes') ? true : false,
              enrollment_type: enrollmentType
            });
          }
        } catch (err) {
          console.error("Error processing row:", err);
        }
      });
      
      return courses;
    }

    // Collect current courses
    const currentCoursesTable = document.getElementById('my_courses_table');
    let currentCourses = [];
    
    if (currentCoursesTable) {
      const currentRows = currentCoursesTable.querySelectorAll('tbody tr');
      currentCourses = extractCoursesFromRows(currentRows, 'Current');
    }
    
    // Collect past courses
    const pastCoursesTable = document.getElementById('past_enrollments_table');
    let pastCourses = [];
    
    if (pastCoursesTable) {
      const pastRows = pastCoursesTable.querySelectorAll('tbody tr');
      pastCourses = extractCoursesFromRows(pastRows, 'Past');
    }
    
    return {
      currentCourses,
      pastCourses,
      totalCourses: currentCourses.length + pastCourses.length
    };
  } catch (err) {
    return { error: `Failed to scrape data: ${err.message}` };
  }
}

// Event listeners
scrapeAllButton.addEventListener('click', () => {
  updateResponse("The 'Scrape All Content' feature is not implemented yet.");
});

scrapeCourseButton.addEventListener('click', scrapeCourses);