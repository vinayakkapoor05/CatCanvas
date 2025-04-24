from dotenv import load_dotenv
import os

def load_env():
    load_dotenv()
    return {
        "OPENAI_API_KEY": os.getenv("OPENAI_API_KEY"),
        "CANVAS_ACCESS_TOKEN": os.getenv("CANVAS_ACCESS_TOKEN"),
        "BASE_URL": os.getenv("BASE_URL", "https://canvas.northwestern.edu/api/v1")
    }