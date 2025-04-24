import openai
import json
from utils import load_env

env = load_env()
API_KEY = env["OPENAI_API_KEY"]

def parse_syllabus(file_path):
    with open(file_path, 'r') as file:
        syllabus_text = file.read()

    prompt = f"""
    Extract grade calculation formula details from the syllabus below in JSON format:
    {syllabus_text}

    Output format:
    [
        {{
            "grade_calculation_formula": "(lab_grade*.58) + (exam_grade*.30) + (assignment_grade*.12) + (final_project*0)",
            "late_days": "4",
            "number_of_dropped_assignments": "0",
            "lab_percentage": "58",
            "exam_percentage": "30",
            "assignment_percentage": "12",
            "final_project_percentage": "0"
        }}
    ]
    """

    response = openai.ChatCompletion.create(
        model="gpt-4",
        messages=[
            {"role": "system", "content": "You are an AI assistant that extracts grade calculation details from text."},
            {"role": "user", "content": prompt}
        ],
        api_key=API_KEY
    )

    return json.loads(response.choices[0].message.content)