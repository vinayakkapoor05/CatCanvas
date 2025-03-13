import openai
import json

API_KEY = "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"

def parse_syllabus(file_path):

    # Reads syllabus text and extracts events

    with open(file_path, 'r') as file:
        syllabus_text = file.read()

    prompt = f"""
    Extract structured event details from the syllabus below in JSON format:
    {syllabus_text}

    Output format:
    [
        {{
            "event_name": "Lecture",
            "location": "Room 101, AI Building",
            "description": "Introduction to AI Lecture by Dr. Smith",
            "start_date_and_time": "2023-10-02T10:00:00-07:00",
            "end_date_and_time": "2023-10-02T11:30:00-07:00",
            "timezone": "America/Los_Angeles"
        }},
        ...
    ]
    """

    response = openai.ChatCompletion.create(
        model="gpt-4",
        messages=[{"role": "system", "content": "You are an AI assistant that extracts event details from text."},
                  {"role": "user", "content": prompt}],
        api_key=API_KEY
    )

    events = json.loads(response.choices[0].message.content)

    return events