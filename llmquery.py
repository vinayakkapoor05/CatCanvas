import os
import requests

# === OpenAI setup (commented out) ===
# import openai
# openai.api_key = "your_openai_api_key_here"
# def query_openai(content, question):
#     prompt = (
#         f"The following is the scraped Canvas content:\n\n{content}\n\n"
#         f"Now answer the question based on that content:\n\n{question}"
#     )
#     response = openai.ChatCompletion.create(
#         model="gpt-4",
#         messages=[
#             {"role": "system", "content": "You are an assistant that answers questions based on Canvas content."},
#             {"role": "user", "content": prompt}
#         ],
#         temperature=0.3,
#         max_tokens=1024
#     )
#     return response.choices[0].message["content"].strip()


def load_canvas_content(file_path):
    """Load scraped Canvas content from a text file."""
    with open(file_path, 'r', encoding='utf-8') as f:
        return f.read()


def query_canvas(content, question, model_endpoint="https://api-inference.huggingface.co/models/mistralai/Mixtral-8x7B-Instruct-v0.1", api_key="hf_your_huggingface_api_key_here"):
    """
    Send the scraped content and a user question to the Hugging Face LLM and return the answer.
    """
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    prompt = (
        f"The following is the scraped Canvas content:\n\n{content}\n\n"
        f"Now answer the question based on that content:\n\n{question}"
    )

    data = {
        "inputs": prompt,
        "parameters": {
            "temperature": 0.3,
            "max_new_tokens": 1024
        }
    }

    response = requests.post(model_endpoint, headers=headers, json=data)
    if response.status_code != 200:
        raise Exception(f"Hugging Face API Error: {response.status_code} - {response.text}")

    result = response.json()
    return result[0].get("generated_text", "(No response generated)").strip()


def main():
    # Default path to the downloaded Canvas content file
    downloads_folder = os.path.join(os.path.expanduser("~"), "Downloads")
    default_file = os.path.join(downloads_folder, "canvas_content.txt")

    if not os.path.isfile(default_file):
        print(f"Error: File not found at {default_file}")
        return

    content = load_canvas_content(default_file)
    print(f"Loaded Canvas content from {default_file} ({len(content)} characters).")

    while True:
        try:
            question = input("\nEnter your question (or 'exit' to quit): ")
        except (KeyboardInterrupt, EOFError):
            print("\nExiting.")
            break
        if question.strip().lower() in ('exit', 'quit'):
            print("Goodbye.")
            break

        try:
            answer = query_canvas(content, question)
            # If using OpenAI instead:
            # answer = query_openai(content, question)
            print(f"\nAnswer:\n{answer}\n")
        except Exception as e:
            print(f"Error querying LLM: {e}")

if __name__ == "__main__":
    main()
