import json
import networkx as nx
from collections import defaultdict, deque

class CourseScheduler:
    def __init__(self, requirements_json, taken_courses_json):
        # Load requirements and taken courses
        self.requirements = requirements_json if isinstance(requirements_json, dict) else json.loads(requirements_json)
        self.taken_courses = taken_courses_json if isinstance(taken_courses_json, list) else json.loads(taken_courses_json)
        
        # Initialize data structures
        self.course_graph = nx.DiGraph()
        self.remaining_requirements = self._clone_requirements()
        self.course_mappings = self._create_course_mappings()
        self.schedule = self._initialize_schedule()
        
        # Process courses already taken
        self.processed_courses = set()
        self._process_taken_courses()
        
        # Build course dependency graph
        self._build_course_graph()
    
    def _clone_requirements(self):
        """Create a deep copy of the requirements that we can modify"""
        return json.loads(json.dumps(self.requirements))
    
    def _create_course_mappings(self):
        """Create mappings from course codes to standardized format"""
        mappings = {
            "COMP_SCI": "CS",
            "ENGLISH": "ENGL",
            "GEN_ENG": "Gen_Eng",
            "MATH": "Math"
        }
        return mappings
    
    def _standardize_course_code(self, subject, number):
        """Convert course codes to a standard format used in requirements"""
        subject = self.course_mappings.get(subject, subject)
        return f"{subject} {number}"
    
    def _initialize_schedule(self):
        """Initialize empty schedule structure based on requirements"""
        schedule = {}
        for year in ["freshman", "sophomore", "junior", "senior"]:
            schedule[year] = {}
            for term in ["fall", "winter", "spring"]:
                schedule[year][term] = []
        return schedule
    
    def _process_taken_courses(self):
        """Process courses already taken by the student"""
        # Create lookup set for taken courses
        for course in self.taken_courses:
            subject = course["subject"]
            number = course["course_number"]
            std_code = self._standardize_course_code(subject, number)
            
            # Mark course as processed
            self.processed_courses.add(std_code)
            
            # Remove from requirements
            self._remove_course_from_requirements(std_code)
    
    def _remove_course_from_requirements(self, course_code):
        """Remove a course from remaining requirements"""
        # Check core courses
        req_cats = self.remaining_requirements["requirement_categories"]
        
        # Check CS core courses
        if "cs_requirements" in req_cats:
            cs_reqs = req_cats["cs_requirements"]
            core_courses = cs_reqs.get("core_courses", [])
            
            # Handle course alternatives (like CS 110/111)
            for i, core in enumerate(core_courses):
                if "/" in core:
                    options = core.split("/")
                    for option in options:
                        if f"CS {option}" == course_code:
                            cs_reqs["core_courses"].pop(i)
                            break
                elif core == course_code:
                    cs_reqs["core_courses"].pop(i)
                    break
        
        # Remove from year plan
        for year in self.remaining_requirements["year_plan"]:
            for term in self.remaining_requirements["year_plan"][year]:
                courses = self.remaining_requirements["year_plan"][year][term]
                for i, course_info in enumerate(courses):
                    if course_info["course"] == course_code:
                        self.remaining_requirements["year_plan"][year][term].pop(i)
                        return
                    # Check for course alternatives
                    if "or" in course_info["course"]:
                        options = course_info["course"].split(" or ")
                        if course_code in options:
                            self.remaining_requirements["year_plan"][year][term].pop(i)
                            return
    
    def _build_course_graph(self):
        """Build dependency graph for courses"""
        # Add all remaining courses as nodes
        for year in self.remaining_requirements["year_plan"]:
            for term in self.remaining_requirements["year_plan"][year]:
                for course_info in self.remaining_requirements["year_plan"][year][term]:
                    course_name = course_info["course"]
                    # Handle alternative courses (like "CS 110 or 111")
                    if " or " in course_name:
                        options = course_name.split(" or ")
                        for option in options:
                            self.course_graph.add_node(option)
                    else:
                        self.course_graph.add_node(course_name)
        
        # Add prerequisite edges
        # Core CS courses usually have prerequisites
        self._add_cs_prerequisite_edges()
        
        # Add ordering constraints based on year/term
        self._add_term_ordering_edges()
    
    def _add_cs_prerequisite_edges(self):
        """Add prerequisite edges for CS courses"""
        # Common CS prerequisites (simplified)
        prerequisites = {
            "CS 211": ["CS 111", "CS 150", "CS 214"],  # CS 211 requires CS 111 or CS 150 or CS 214
            "CS 212": ["CS 211"],
            "CS 213": ["CS 211"],
            "CS 214": ["CS 111", "CS 150"],  # CS 214 requires CS 111 or CS 150
            "CS Breadth (1)": ["CS 211"],
            "CS Breadth (2)": ["CS 211"],
            "CS Breadth (3)": ["CS 211"],
            "CS Breadth (4)": ["CS 213", "CS 212"],
            "CS Breadth (5)": ["CS 213", "CS 212"],
            "Tech Elect (1)": ["CS 213", "CS 212"],
            "Project 1": ["CS Breadth (4)", "CS Breadth (3)"],
            "Project 2": ["Project 1"]
        }
        
        # Add edges
        for course, prereqs in prerequisites.items():
            if course in self.course_graph:
                for prereq in prereqs:
                    if prereq in self.course_graph:
                        self.course_graph.add_edge(prereq, course)
    
    def _add_term_ordering_edges(self):
        """Add edges to enforce term ordering"""
        # Define term ordering
        term_order = {
            "freshman": {"fall": 1, "winter": 2, "spring": 3},
            "sophomore": {"fall": 4, "winter": 5, "spring": 6},
            "junior": {"fall": 7, "winter": 8, "spring": 9},
            "senior": {"fall": 10, "winter": 11, "spring": 12}
        }
        
        # Create mapping of courses to their original terms
        course_term_map = {}
        for year in self.requirements["year_plan"]:
            for term in self.requirements["year_plan"][year]:
                term_value = term_order[year][term]
                for course_info in self.requirements["year_plan"][year][term]:
                    course_name = course_info["course"]
                    if " or " in course_name:
                        options = course_name.split(" or ")
                        for option in options:
                            course_term_map[option] = term_value
                    else:
                        course_term_map[course_name] = term_value
        
        # Add term ordering edges
        nodes = list(self.course_graph.nodes())
        for i, course1 in enumerate(nodes):
            if course1 in course_term_map:
                term1 = course_term_map[course1]
                for course2 in nodes[i+1:]:
                    if course2 in course_term_map:
                        term2 = course_term_map[course2]
                        if term1 < term2:
                            # Don't add edges between unrelated courses
                            if not (self._is_specific_requirement(course1) and self._is_specific_requirement(course2)):
                                self.course_graph.add_edge(course1, course2)
    
    def _is_specific_requirement(self, course):
        """Check if a course is a specific named requirement like 'Theme (1)'"""
        requirement_patterns = ["Basic Eng", "CS Breadth", "Tech Elect", "Theme", "Unrestricted", "Project"]
        return any(pattern in course for pattern in requirement_patterns)
    
    def generate_schedule(self):
        """Generate a suggested schedule based on remaining requirements"""
        # First, identify current year and term based on taken courses
        current_position = self._identify_current_position()
        current_year, current_term = current_position
        
        # Get topological sort of courses
        try:
            course_order = list(nx.topological_sort(self.course_graph))
        except nx.NetworkXUnfeasible:
            # Handle cycles in the graph
            print("Warning: Circular dependencies detected in course requirements")
            course_order = list(self.course_graph.nodes())
        
        # Filter out processed courses
        course_order = [c for c in course_order if c not in self.processed_courses]
        
        # Map courses to terms based on dependencies and load balancing
        return self._assign_courses_to_terms(course_order, current_year, current_term)
    
    def _identify_current_position(self):
        """Identify student's current position in the program"""
        # Count courses taken by year and term
        year_term_counts = defaultdict(int)
        for year in self.requirements["year_plan"]:
            for term in self.requirements["year_plan"][year]:
                for course_info in self.requirements["year_plan"][year][term]:
                    course = course_info["course"]
                    if " or " in course:
                        options = course.split(" or ")
                        if any(
                            len(opt.split(" ")) > 1 and self._standardize_course_code("COMP_SCI", opt.split(" ")[1]) in self.processed_courses
                            for opt in options
                        ):                            
                            year_term_counts[(year, term)] += 1
                    else:
                        std_code = course
                        if std_code in self.processed_courses:
                            year_term_counts[(year, term)] += 1
        
        # Find the term with the most courses taken
        max_count = 0
        current_position = ("freshman", "fall")  # Default
        
        for (year, term), count in year_term_counts.items():
            if count > max_count:
                max_count = count
                current_position = (year, term)
        
        # Move to next term
        return self._get_next_term(current_position[0], current_position[1])
    
    def _get_next_term(self, year, term):
        """Get the next term after the given year and term"""
        terms = ["fall", "winter", "spring"]
        years = ["freshman", "sophomore", "junior", "senior"]
        
        term_idx = terms.index(term)
        year_idx = years.index(year)
        
        if term_idx < len(terms) - 1:
            return (year, terms[term_idx + 1])
        else:
            if year_idx < len(years) - 1:
                return (years[year_idx + 1], terms[0])
            else:
                return (year, term)  # Stay in senior spring if we're already there
    
    def _assign_courses_to_terms(self, course_order, start_year, start_term):
        """Assign courses to terms based on dependencies and load balancing"""
        # Define term sequence
        terms = ["fall", "winter", "spring"]
        years = ["freshman", "sophomore", "junior", "senior"]
        
        # Find starting position in the sequence
        year_idx = years.index(start_year)
        term_idx = terms.index(start_term)
        
        # Initialize current term and units
        current_year = years[year_idx]
        current_term = terms[term_idx]
        term_units = 0
        max_units_per_term = 4  # Maximum units per term
        
        # Clone the recommended schedule structure
        suggested_schedule = self._initialize_schedule()
        
        # Keep track of what requirements have been assigned
        assigned_requirements = {
            "cs_breadth": 0,
            "tech_electives": 0,
            "theme": 0,
            "basic_eng": 0,
            "unrestricted": 0,
            "project": 0,
            "basic_science": 0
        }
        
        # Track prerequisites met
        prereqs_met = set(self.processed_courses)
        
        # Assign courses in topological order
        remaining_courses = deque(course_order)
        
        while remaining_courses:
            # Find courses whose prerequisites have been met
            assignable_courses = []
            for course in remaining_courses:
                predecessors = list(self.course_graph.predecessors(course))
                if all(pred in prereqs_met for pred in predecessors):
                    assignable_courses.append(course)
            
            if not assignable_courses:
                # If we can't assign any more courses, break
                break
            
            # Sort assignable courses to prioritize core courses
            assignable_courses.sort(key=lambda c: 0 if "CS" in c and not any(req in c for req in ["Breadth", "Elect", "Theme"]) else 1)
            
            # Try to assign courses to current term
            for course in assignable_courses:
                # Skip if term is full
                if term_units >= max_units_per_term:
                    break
                
                # Add course to schedule
                unit_value = 1  # Default value
                suggested_schedule[current_year][current_term].append({
                    "course": course,
                    "units": unit_value
                })
                
                # Update counters
                term_units += unit_value
                remaining_courses.remove(course)
                prereqs_met.add(course)
                
                # Update requirement tracking
                if "CS Breadth" in course:
                    assigned_requirements["cs_breadth"] += 1
                elif "Tech Elect" in course:
                    assigned_requirements["tech_electives"] += 1
                elif "Theme" in course:
                    assigned_requirements["theme"] += 1
                elif "Basic Eng" in course:
                    assigned_requirements["basic_eng"] += 1
                elif "Unrestricted" in course:
                    assigned_requirements["unrestricted"] += 1
                elif "Project" in course:
                    assigned_requirements["project"] += 1
                elif "Basic Science" in course:
                    assigned_requirements["basic_science"] += 1
            
            # Move to next term if current term is full or no more assignable courses
            if term_units >= max_units_per_term or not remaining_courses:
                # Move to next term
                term_idx = (term_idx + 1) % len(terms)
                if term_idx == 0:  # Wrapped around to fall
                    year_idx += 1
                    if year_idx >= len(years):
                        # We've gone beyond senior year, stop scheduling
                        break
                
                current_year = years[year_idx]
                current_term = terms[term_idx]
                term_units = 0
        
        # Ensure all requirements are met by adding generic placeholders for unfilled requirements
        self._fill_missing_requirements(suggested_schedule, assigned_requirements)
        
        return suggested_schedule
    
    def _fill_missing_requirements(self, schedule, assigned_requirements):
        """Fill in missing requirements that weren't explicitly scheduled"""
        req_cats = self.requirements["requirement_categories"]
        
        # Check CS breadth requirements
        cs_breadth_req = req_cats["cs_requirements"]["cs_breadth"]["total_required"]
        remaining_breadth = cs_breadth_req - assigned_requirements["cs_breadth"]
        
        # Check tech electives
        tech_elec_req = req_cats["cs_requirements"]["technical_electives"]["total_required"]
        remaining_tech = tech_elec_req - assigned_requirements["tech_electives"]
        
        # Check theme courses
        theme_req = req_cats["theme_courses"]["total_required"]  
        remaining_theme = theme_req - assigned_requirements["theme"]
        
        # Check basic engineering
        basic_eng_req = req_cats["basic_engineering"]["total_required"]
        remaining_basic_eng = basic_eng_req - assigned_requirements["basic_eng"]
        
        # Check unrestricted electives
        unrestricted_req = req_cats["unrestricted_electives"]["total_required"]
        remaining_unrestricted = unrestricted_req - assigned_requirements["unrestricted"]
        
        # Check project courses
        project_req = req_cats["cs_requirements"]["project_courses"]["total_required"]
        remaining_project = project_req - assigned_requirements["project"]
        
        # Check basic sciences
        basic_sci_req = req_cats["basic_sciences"]["total_required"]
        remaining_basic_sci = basic_sci_req - assigned_requirements["basic_science"]
        
        # Fill requirements sequentially through remaining terms
        requirements_to_fill = [
            ("CS Breadth", remaining_breadth),
            ("Tech Elect", remaining_tech),
            ("Theme", remaining_theme),
            ("Basic Eng", remaining_basic_eng),
            ("Basic Science w/ Lab", remaining_basic_sci),
            ("Project", remaining_project),
            ("Unrestricted", remaining_unrestricted)
        ]
        
        # Define term sequence from current position to end
        terms = ["fall", "winter", "spring"]
        years = ["freshman", "sophomore", "junior", "senior"]
        
        # Start filling from where we left off
        for year in years:
            for term in terms:
                # Skip if term already has 4 units
                if len(schedule[year][term]) >= 4:
                    continue
                
                # Calculate available units in this term
                available_units = 4 - len(schedule[year][term])
                
                # Try to fill with remaining requirements
                for req_type, remaining in requirements_to_fill:
                    while remaining > 0 and available_units > 0:
                        if req_type == "CS Breadth":
                            index = assigned_requirements["cs_breadth"] + 1
                            course_name = f"CS Breadth ({index})"
                        elif req_type == "Tech Elect":
                            index = assigned_requirements["tech_electives"] + 1
                            course_name = f"Tech Elect ({index})"
                        elif req_type == "Theme":
                            index = assigned_requirements["theme"] + 1
                            course_name = f"Theme ({index})"
                        elif req_type == "Basic Eng":
                            index = assigned_requirements["basic_eng"] + 1
                            course_name = f"Basic Eng ({index})"
                        elif req_type == "Basic Science w/ Lab":
                            index = assigned_requirements["basic_science"] + 1
                            course_name = f"Basic Science w/ Lab ({index})"
                        elif req_type == "Project":
                            index = assigned_requirements["project"] + 1
                            course_name = f"Project {index}"
                        else: # Unrestricted
                            index = assigned_requirements["unrestricted"] + 1
                            course_name = f"Unrestricted ({index})"
                        
                        # Add to schedule
                        schedule[year][term].append({
                            "course": course_name,
                            "units": 1
                        })
                        
                        # Update counters
                        remaining -= 1
                        available_units -= 1
                        
                        if req_type == "CS Breadth":
                            assigned_requirements["cs_breadth"] += 1
                        elif req_type == "Tech Elect":
                            assigned_requirements["tech_electives"] += 1
                        elif req_type == "Theme":
                            assigned_requirements["theme"] += 1
                        elif req_type == "Basic Eng":
                            assigned_requirements["basic_eng"] += 1
                        elif req_type == "Basic Science w/ Lab":
                            assigned_requirements["basic_science"] += 1
                        elif req_type == "Project":
                            assigned_requirements["project"] += 1
                        else: # Unrestricted
                            assigned_requirements["unrestricted"] += 1
    
    def generate_recommendation_report(self):
        """Generate a comprehensive report of the recommended schedule"""
        schedule = self.generate_schedule()
        
        report = {
            "student_progress": {
                "courses_completed": len(self.processed_courses),
                "courses_remaining": sum(len(schedule[year][term]) for year in schedule for term in schedule[year])
            },
            "recommended_schedule": schedule,
            "notes": []
        }
        
        # Add notes about CS sequence
        if "CS 211" not in self.processed_courses:
            report["notes"].append("Note: CS 211 is a prerequisite for many upper-level CS courses.")
        
        # Add notes about breadth requirements
        req_cats = self.requirements["requirement_categories"]
        cs_breadth_req = req_cats["cs_requirements"]["cs_breadth"]["total_required"]
        report["notes"].append(f"Complete all {cs_breadth_req} CS breadth courses to fulfill degree requirements.")
        
        # Add notes about theme courses
        theme_req = req_cats["theme_courses"]["total_required"]
        report["notes"].append(f"Theme courses ({theme_req} required) should form a coherent sequence in humanities/social sciences.")
        
        # Add note about technical electives
        tech_elec_req = req_cats["cs_requirements"]["technical_electives"]["total_required"]
        report["notes"].append(f"Choose {tech_elec_req} technical electives based on your interests and career goals.")
        
        return report


def main():
    # Sample usage
    with open('requirements.json', 'r') as f:
        requirements = json.load(f)
    
    with open('taken_courses.json', 'r') as f:
        taken_courses = json.load(f)
    
    scheduler = CourseScheduler(requirements, taken_courses)
    recommendation = scheduler.generate_recommendation_report()
    
    # Print the recommendation in a readable format
    print("RECOMMENDED 4-YEAR SCHEDULE FOR CS MAJOR")
    print("========================================")
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