document.addEventListener("DOMContentLoaded", function () {
  const signInButton = document.getElementById("signinButton");
  const syncButton = document.getElementById("syncButton"); // Ensure this exists in popup.html

  let accessToken = null;

  signInButton.addEventListener("click", function () {
      const authUrl = "https://kh77trdh96.execute-api.us-east-2.amazonaws.com/test/auth/google";

      chrome.identity.launchWebAuthFlow(
          {
              url: authUrl,
              interactive: true
          },
          function (redirectUrl) {
              if (chrome.runtime.lastError || !redirectUrl) {
                  console.error("OAuth failed:", JSON.stringify(chrome.runtime.lastError));
                  return;
              }

              // Log the redirect URL to inspect its contents
              console.log("Redirect URL:", redirectUrl);

              // Ensure the redirect URL contains the token (typically in hash after the `#` symbol)
              const url = new URL(redirectUrl);
              const params = new URLSearchParams(url.hash.substring(1)); // Extract query from the hash

              const accessToken = params.get("access_token");

              if (accessToken) {
                  console.log("Access token received:", accessToken);
                  alert("Sign-in successful!");
              } else {
                  console.error("Access token not found in redirect URL.");
              }
          }
      );
  });

  syncButton.addEventListener("click", async function () {
      if (!accessToken) {
          alert("Please sign in first.");
          return;
      }

      const syllabusText = "This course has deadlines: Homework 1 due March 13th";

      try {
          const response = await fetch('https://kh77trdh96.execute-api.us-east-2.amazonaws.com/test/process-syllabus', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  access_token: accessToken,
                  syllabus: syllabusText
              })
          });

          const data = await response.json();
          console.log("API Response:", data);
          alert("Syllabus processed successfully!");
      } catch (error) {
          console.error("Error processing syllabus:", error);
          alert("Failed to process syllabus.");
      }
  });
});



// function openOAuthPopup(url, name, width, height) {
//     // Calculate position for the popup to be centered
//     const left = (screen.width / 2) - (width / 2);
//     const top = (screen.height / 2) - (height / 2);
  
//     // Open the popup window
//     const popup = window.open(url, name, `width=${width},height=${height},left=${left},top=${top}`);
  
//     return popup;
// }

// sign in button -> open link when pressed: https://kh77trdh96.execute-api.us-east-2.amazonaws.com/test/auth/google
// listen for redirect to be able to get authorization key
// document.addEventListener("DOMContentLoaded", function () {
//     var accessToken;
//     const signInButton = document.getElementById("signinButton");
  
//     signInButton.addEventListener("click", async function () {
//       try {
//         // open the OAuth link in a new tab
//         const authUrl = "https://kh77trdh96.execute-api.us-east-2.amazonaws.com/test/auth/google";
//         const popup = openOAuthPopup(authUrl, 'OAuthPopup', 600, 600);

//         window.addEventListener("message", function (event) {
//             // handle the OAuth response (ex -> authorization code or token)
//             const oauthResponse = event.data;
//             console.log("OAuth response received:", oauthResponse);

//             // store token
//             if (oauthResponse.access_token) {
//                 console.log("Authorization code:", oauthResponse.access_token);
//                 //localStorage.setItem("access_token", oauthResponse.access_token);
//                 accessToken = oauthResponse.access_token;
//             }
//         });

//       } catch (error) {
//         console.error("Sign-in failed:", error);
//         alert("Sign-in failed. Please try again.");
//       }
//     });
// });

// sync button -> 3 things
// do course syllabus text thing
// 

// getting access token
//const accessToken = localStorage.getItem("access_token");