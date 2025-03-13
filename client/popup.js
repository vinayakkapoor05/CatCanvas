function openOAuthPopup(url, name, width, height) {
    // Calculate position for the popup to be centered
    const left = (screen.width / 2) - (width / 2);
    const top = (screen.height / 2) - (height / 2);
  
    // Open the popup window
    const popup = window.open(url, name, `width=${width},height=${height},left=${left},top=${top}`);
  
    return popup;
}

// sign in button -> open link when pressed: https://kh77trdh96.execute-api.us-east-2.amazonaws.com/test/auth/google
// listen for redirect to be able to get authorization key
document.addEventListener("DOMContentLoaded", function () {
    var accessToken;
    const signInButton = document.getElementById("signinButton");
  
    signInButton.addEventListener("click", async function () {
      try {
        // open the OAuth link in a new tab
        const authUrl = "https://kh77trdh96.execute-api.us-east-2.amazonaws.com/test/auth/google";
        const popup = openOAuthPopup(authUrl, 'OAuthPopup', 600, 600);

        window.addEventListener("message", function (event) {
            // handle the OAuth response (ex -> authorization code or token)
            const oauthResponse = event.data;
            console.log("OAuth response received:", oauthResponse);

            // store token
            if (oauthResponse.access_token) {
                console.log("Authorization code:", oauthResponse.access_token);
                //localStorage.setItem("access_token", oauthResponse.access_token);
                accessToken = oauthResponse.access_token;
            }
        });

      } catch (error) {
        console.error("Sign-in failed:", error);
        alert("Sign-in failed. Please try again.");
      }
    });
});

// sync button -> 3 things
// do course syllabus text thing
// 

// getting access token
//const accessToken = localStorage.getItem("access_token");