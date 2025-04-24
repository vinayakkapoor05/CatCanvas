from extract_syllabus import parse_syllabus
from get_grades import get_courses, get_assignment_grades_by_category
from calculate import calculate_final_grade

def main():
    syllabus_path = input("Enter path to your syllabus text file: ")
    syllabus_data = parse_syllabus(syllabus_path)
    formula = syllabus_data["grade_calculation_formula"]

    courses = get_courses()
    print("\nAvailable Courses:")
    for idx, course in enumerate(courses):
        print(f"{idx + 1}. {course['name']}")

    selected_index = int(input("\nChoose a course number: ")) - 1
    course_id = courses[selected_index]["id"]

    grades = get_assignment_grades_by_category(course_id)
    print("\nCategory Averages:")
    for category, avg in grades.items():
        print(f"{category}: {avg:.2f}")

    try:
        final_grade = calculate_final_grade(formula, grades)
        print(f"\nFinal Calculated Grade: {final_grade:.2f}")
    except ValueError as e:
        print(f"\n{e}")

if __name__ == "__main__":
    main()