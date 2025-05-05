/*
 * recursive_summary.js
 * Implements a recursive summarization system to chunk large Canvas context
 * and summarize it into smaller pieces to avoid LLM token overflow.
 */

// === Utilities ===

/**
 * Split a large text into chunks not exceeding maxChars characters.
 * Attempts to split on sentence boundaries for readability.
 * @param {string} text - The full text to chunk.
 * @param {number} maxChars - Maximum characters per chunk.
 * @returns {string[]} Array of text chunks.
 */
function chunkText(text, maxChars = 15000) {
    const sentences = text.match(/[^.!?]+[.!?]+\s*/g) || [text];
    const chunks = [];
    let current = '';
  
    for (const sentence of sentences) {
      if ((current + sentence).length > maxChars) {
        if (current) {
          chunks.push(current.trim());
          current = '';
        }
        // Sentence itself may exceed maxChars: split by substring
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
    if (current) {
      chunks.push(current.trim());
    }
    return chunks;
  }
  
  /**
   * Send a summarization request to the LLM for one chunk.
   * @param {string} chunk - Text chunk to summarize.
   * @returns {Promise<string>} Summary of the chunk.
   */
  async function summarizeChunk(chunk) {
    const systemPrompt = "You are a helpful assistant that concisely summarizes the meaning of text in very few words.";
    const userPrompt = `Please provide a very concise summary of the following content:\n\n${chunk}`;
  
    const res = await fetch("https://api.together.xyz/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${TUTORIAL_API_KEY}`,
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
  
    if (!res.ok) {
      throw new Error(`Summarization API error: ${res.status}`);
    }
    const data = await res.json();
    return data.choices[0].message.content.trim();
  }
  
  /**
   * Recursively summarize large text by chunking and combining summaries.
   * @param {string} text - The full text to summarize.
   * @param {number} maxChars - Character limit under which we stop recursion.
   * @returns {Promise<string>} Final recursive summary.
   */
  async function recursiveSummarize(text, maxChars = 15000) {
    if (text.length <= maxChars) {
      return text;
    }
  
    const chunks = chunkText(text, maxChars);
    const summaries = [];
  
    for (const chunk of chunks) {
      const summary = await summarizeChunk(chunk);
      summaries.push(summary);
    }
  
    const combined = summaries.join('\n');
    // If still too long, recurse
    return combined.length > maxChars
      ? await recursiveSummarize(combined, maxChars)
      : combined;
  }
  
  // === Integration with Query Button ===
  
  document.getElementById("queryBtn").addEventListener("click", async () => {
    const prompt = document.getElementById("userPrompt").value;
    const responseDiv = document.getElementById("response");
    responseDiv.innerText = "Generating summary and querying...";
  
    if (!canvasCache) {
      responseDiv.innerText = "No Canvas data cached. Please scrape first.";
      return;
    }
  
    try {
      // First, recursively summarize the cached context
      const summaryContext = await recursiveSummarize(canvasCache);
  
      // Then query the LLM with the user's prompt and the summarized context
      const result = await queryLLM(prompt, summaryContext);
      responseDiv.innerText = result;
    } catch (err) {
      console.error(err);
      responseDiv.innerText = `Error during summarization/query: ${err.message}`;
    }
  });
  