import fitz  # PyMuPDF
import re
import json

def extract_text_from_pdf(pdf_path):
    """Extract text from a PDF file using PyMuPDF."""
    doc = fitz.open(pdf_path)
    full_text = ""
    for page in doc:
        full_text += page.get_text()
    return full_text

def extract_courses_from_text(text):
    """Use regex to extract course info from transcript text."""
    course_pattern = re.compile(
        r'(?P<subject>[A-Z_]{2,})\s+'
        r'(?P<course_number>\d{3}-\d)\s+'
        r'(?P<title>.*?)\s+'
        r'(?P<attempted>\d\.\d{3})\s+'
        r'(?P<earned>\d\.\d{3})\s+'
        r'(?P<grade>[A-F][+-]?|S|P|N)\s+'
        r'(?P<points>\d\.\d{3})',
        re.MULTILINE
    )

    courses = []
    for match in course_pattern.finditer(text):
        courses.append(match.groupdict())
    return courses

def save_courses_to_json(courses, output_path="courses.json"):
    """Save the extracted course data to a JSON file."""
    with open(output_path, "w") as f:
        json.dump(courses, f, indent=2)

# Main Function
if __name__ == "__main__":
    pdf_path = "SSR_TSRPT.pdf"  # Change this to your actual file path
    raw_text = extract_text_from_pdf(pdf_path)
    course_data = extract_courses_from_text(raw_text)

    if course_data:
        save_courses_to_json(course_data)
        print(f"Extracted {len(course_data)} courses and saved to 'courses.json'")
    else:
        print("No courses found in the transcript.")