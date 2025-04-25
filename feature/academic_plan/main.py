from recommend_plan import CourseScheduler
import json

def main():
    with open('requirements.json', 'r') as f:
        requirements = json.load(f)
    
    with open('taken_courses.json', 'r') as f:
        taken_courses = json.load(f)
    
    scheduler = CourseScheduler(requirements, taken_courses)
    recommendation = scheduler.generate_recommendation_report()
    
    # Print the recommendation in a readable format
    print("RECOMMENDED 4-YEAR SCHEDULE FOR CS MAJOR")
    print("========================================")
    print(f"Courses required: {recommendation['student_progress']['courses_required']}")
    print(f"Courses completed: {recommendation['student_progress']['courses_completed']}")
    print(f"Courses remaining: {recommendation['student_progress']['courses_remaining']}")
    print()
    
    for year in ["freshman", "sophomore", "junior", "senior"]:
        print(f"{year.upper()}")
        for term in ["fall", "winter", "spring"]:
            courses = recommendation["recommended_schedule"][year][term]
            if courses:
                print(f"  {term.capitalize()}:")
                for course in courses:
                    print(f"    - {course['course']} ({course['units']} unit{'s' if course['units'] > 1 else ''})")
            else:
                print(f"  {term.capitalize()}: No courses scheduled")
        print()
    
    print("NOTES:")
    for note in recommendation["notes"]:
        print(f"- {note}")

if __name__ == "__main__":
    main()