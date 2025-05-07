#!/usr/bin/env python3
"""
Before running, ensure you have the latest Transformers with Qwen3‑MoE support:
    pip install --upgrade transformers accelerate
# Or for bleeding‑edge:
#   pip install --upgrade git+https://github.com/huggingface/transformers.git@main
"""

import os
import argparse
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM, pipeline

# Approximate context limit in characters (tune as needed)
CONTEXT_LIMIT_CHARS = 4000  

def load_canvas_content(file_path: str) -> str:
    """Load scraped Canvas content from a text file."""
    with open(file_path, 'r', encoding='utf-8') as f:
        return f.read()

def split_into_chunks(text: str, max_chars: int = CONTEXT_LIMIT_CHARS) -> list[str]:
    """Split large text into smaller chunks within a character limit."""
    return [text[i : i + max_chars] for i in range(0, len(text), max_chars)]

def init_qwen_pipeline(api_token: str):
    """
    Initialize Qwen3-235B-A22B text-generation pipeline with PyTorch backend,
    trusting remote code for the MoE architecture.
    """
    os.environ["HUGGINGFACEHUB_API_TOKEN"] = api_token
    model_name = "Qwen/Qwen3-235B-A22B"

    # Load tokenizer & model
    tokenizer = AutoTokenizer.from_pretrained(
        model_name,
        trust_remote_code=True
    )
    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        trust_remote_code=True,
        torch_dtype=torch.bfloat16,   # or "auto" if supported
        device_map="auto"
    )

    # Build the pipeline
    gen_pipe = pipeline(
        "text-generation",
        model=model,
        tokenizer=tokenizer,
        trust_remote_code=True,
        framework="pt",
        device_map="auto"
    )
    return tokenizer, gen_pipe

def clean_chunk_with_qwen(tokenizer, pipe, chunk: str) -> str:
    """
    Use Qwen's chat template to clean a single chunk of Canvas content.
    """
    messages = [
        {"role": "system", "content":
            "You are a helpful assistant that cleans messy Canvas content "
            "so it is readable and well-formatted."
        },
        {"role": "user", "content": chunk},
    ]
    chat_input = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
        enable_thinking=False
    )
    output = pipe(
        chat_input,
        max_new_tokens=1024,
        temperature=0.3,
        do_sample=False
    )
    return output[0]["generated_text"].strip()

def clean_canvas_content(tokenizer, pipe, content: str) -> str:
    """Split content into chunks, clean each via Qwen3, and return full cleaned text."""
    chunks = split_into_chunks(content)
    print(f"Split content into {len(chunks)} chunk(s).")
    cleaned = []
    for idx, chunk in enumerate(chunks, start=1):
        print(f"Cleaning chunk {idx}/{len(chunks)}…")
        cleaned.append(clean_chunk_with_qwen(tokenizer, pipe, chunk))
    return "\n\n".join(cleaned)

def main():
    parser = argparse.ArgumentParser(
        description="Clean scraped Canvas content with Qwen3-235B-A22B"
    )
    parser.add_argument(
        "--input", "-i",
        type=str,
        default=os.path.join(os.path.expanduser("~"), "Downloads", "canvas_content.txt"),
        help="Path to the raw Canvas text file"
    )
    parser.add_argument(
        "--output", "-o",
        type=str,
        default=os.path.join(os.path.expanduser("~"), "Downloads", "canvas_cleaned.txt"),
        help="Where to save the cleaned output"
    )
    args = parser.parse_args()

    # Hard‑coded Hugging Face API token
    api_token = "hf_your_actual_token_here"

    if not os.path.isfile(args.input):
        print(f"Error: Input file not found at {args.input}")
        return

    content = load_canvas_content(args.input)
    print(f"Loaded {len(content)} characters from {args.input}")

    tokenizer, pipe = init_qwen_pipeline(api_token)
    cleaned_text = clean_canvas_content(tokenizer, pipe, content)

    with open(args.output, "w", encoding="utf-8") as out_f:
        out_f.write(cleaned_text)
    print(f"Cleaned content written to {args.output}")

if __name__ == "__main__":
    main()
