import requests
import json
from utils import load_env

# Replace these with actual token and base URL
ACCESS_TOKEN = "YOUR_CANVAS_ACCESS_TOKEN"
BASE_URL = "https://canvas.northwestern.edu/api/v1"

HEADERS = {
    "Authorization": f"Bearer {ACCESS_TOKEN}"
}

CATEGORY_KEYWORDS = {
    "lab": ["lab", "experiment"],
    "exam": ["exam", "midterm", "final"],
    "assignment": ["assignment", "hw", "homework", "problem set", "pset"],
    "project": ["project", "capstone"]
}

def categorize_assignment(name):
    name_lower = name.lower()
    for category, keywords in CATEGORY_KEYWORDS.items():
        if any(keyword in name_lower for keyword in keywords):
            return category
    return "other"

def get_courses():
    """
    Returns a list of active courses.
    """
    response = requests.get(f"{BASE_URL}/courses", headers=HEADERS, params={"enrollment_state": "active"})
    response.raise_for_status()
    return response.json()

def get_assignments(course_id):
    """
    Gets assignments for a specific course ID.
    """
    response = requests.get(f"{BASE_URL}/courses/{course_id}/assignments", headers=HEADERS)
    response.raise_for_status()
    return response.json()

def get_assignment_grades_by_category(course_id):
    """
    Returns average grade per category: lab, exam, assignment, etc.
    """
    assignments = get_assignments(course_id)
    category_scores = {}
    category_counts = {}

    for assignment in assignments:
        if assignment.get("score") is not None:
            category = categorize_assignment(assignment["name"])
            category_scores[category] = category_scores.get(category, 0) + assignment["score"]
            category_counts[category] = category_counts.get(category, 0) + 1

    # Average each category
    category_averages = {}
    for category, total_score in category_scores.items():
        count = category_counts[category]
        if count > 0:
            category_averages[f"{category}_grade"] = total_score / count

    return category_averages