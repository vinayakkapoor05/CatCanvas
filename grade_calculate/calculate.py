def calculate_final_grade(formula: str, grades: dict) -> float:
    """
    Evaluates the final grade using the extracted formula and grade averages.

    Parameters:
    - formula (str): A string formula like "(lab_grade*.58) + (exam_grade*.30)"
    - grades (dict): A dictionary of grades like {'lab_grade': 92.0, 'exam_grade': 87.5}

    Returns:
    - float: Final calculated grade
    """
    try:
        final_grade = eval(formula, {}, grades)
        return final_grade
    except Exception as e:
        raise ValueError(f"Error calculating grade with given formula and grades: {e}")