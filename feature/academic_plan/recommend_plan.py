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
        
        # Initialize course mappings as an empty dictionary
        self.course_mappings = {}
        self.course_mappings = self._create_course_mappings()
        
        # Process courses already taken
        self.processed_courses = set()
        
        # Extract year and term information from taken courses
        self.student_year, self.student_term = self._identify_student_term_from_taken_courses()
        
        # Initialize schedule with proper starting point
        self.schedule = self._initialize_schedule_from_student_position()
        
        # Process taken courses after we have the student position
        self._process_taken_courses()
        
        # Store original course order from requirements
        self.original_course_order = self._extract_original_course_order()
        
        # Build course dependency graph
        self._build_course_graph()
        
    def _clone_requirements(self):
        """Create a deep copy of the requirements that we can modify"""
        return json.loads(json.dumps(self.requirements))
    
    def _create_course_mappings(self):
        """Create a map from standardized course code to course title"""
        title_map = {}
        for course in self.taken_courses:
            subject = course["subject"]
            number = course["course_number"]
            if number.endswith("-0"):
                number = number[:-2]
            code = self._standardize_course_code(subject, number)
            title_map[code] = course.get("title", code)
        return title_map
    
    def _standardize_course_code(self, subject, number):
        """Convert course codes to a standard format used in requirements"""
        subject = self.course_mappings.get(subject, subject)
        return f"{subject} {number}"
    
    def _parse_alternative_courses(self, course_str):
        """Parse course string that might contain 'or' alternatives"""
        if " or " not in course_str:
            return [course_str]
        
        # Split on "or" and handle cases like "CS 214 or 211" -> ["CS 214", "CS 211"]
        parts = course_str.split(" or ")
        result = []
        
        for i, part in enumerate(parts):
            if i == 0 or " " in part:  # Complete course with subject
                result.append(part)
            else:  # Just a number, use the subject from the previous course
                prev_subj = parts[i-1].split(" ")[0]
                result.append(f"{prev_subj} {part}")
        
        return result
    
    def _initialize_schedule(self):
        """Initialize empty schedule structure based on requirements"""
        schedule = {}
        for year in ["freshman", "sophomore", "junior", "senior"]:
            schedule[year] = {}
            for term in ["fall", "winter", "spring"]:
                schedule[year][term] = []
        return schedule
    
    def _identify_student_term_from_taken_courses(self):
        """Identify the student's current year and term based on taken courses"""
        # If no courses taken, assume freshman fall
        if not self.taken_courses:
            return "freshman", "fall"
        
        # Count courses taken by term
        most_recent_term = None
        most_recent_year = None
        
        # Check if courses have year/term information
        # If yes, use the most recent term from the data
        has_term_info = any('term' in course and 'year' in course for course in self.taken_courses)
        
        if has_term_info:
            for course in self.taken_courses:
                if 'term' in course and 'year' in course:
                    year = course['year'].lower()  # normalize to lowercase
                    term = course['term'].lower()
                    
                    # Update if this is more recent
                    if most_recent_year is None or self._is_later_term(year, term, most_recent_year, most_recent_term):
                        most_recent_year = year
                        most_recent_term = term
            
            # If we found year/term info, calculate next term
            if most_recent_year is not None:
                return self._get_next_term(most_recent_year, most_recent_term)
        
        # If no explicit term info, fall back to matching against requirements
        # (use existing _identify_current_position method)
        year, term = self._identify_current_position_from_requirements()
        return year, term

    def _is_later_term(self, year1, term1, year2, term2):
        """Check if year1/term1 is later than year2/term2"""
        year_order = {"freshman": 1, "sophomore": 2, "junior": 3, "senior": 4}
        term_order = {"fall": 1, "winter": 2, "spring": 3}
        
        # Convert to numeric values for comparison
        year1_val = year_order.get(year1, 0)
        year2_val = year_order.get(year2, 0)
        term1_val = term_order.get(term1, 0)
        term2_val = term_order.get(term2, 0)
        
        # Compare years first, then terms
        if year1_val > year2_val:
            return True
        elif year1_val == year2_val and term1_val > term2_val:
            return True
        return False

    def _identify_current_position_from_requirements(self):
        """Identify the student's current position in the program based on requirements"""
        # Check the requirements for the most recent year/term
        for year in ["freshman", "sophomore", "junior", "senior"]:
            if year in self.requirements["year_plan"]:
                for term in ["fall", "winter", "spring"]:
                    if term in self.requirements["year_plan"][year]:
                        return year, term
        
        # Default to freshman fall if nothing found
        return "freshman", "fall"
    
    def _initialize_schedule_from_student_position(self):
        """Initialize empty schedule structure starting from the student's current position"""
        schedule = {}
        years = ["freshman", "sophomore", "junior", "senior"]
        terms = ["fall", "winter", "spring"]
        
        # Find starting index
        year_idx = years.index(self.student_year) if self.student_year in years else 0
        term_idx = terms.index(self.student_term) if self.student_term in terms else 0
        
        # Initialize schedule with only the necessary terms
        for year_pos in range(year_idx, len(years)):
            year = years[year_pos]
            schedule[year] = {}
            
            # For the first year, start from the current term
            first_term = term_idx if year_pos == year_idx else 0
            
            for term_pos in range(first_term, len(terms)):
                term = terms[term_pos]
                schedule[year][term] = []
        
        return schedule
    
    def _extract_original_course_order(self):
        """Extract the original ordering of courses from the requirements"""
        course_order = []
        
        # Dictionary to store course positions in the original plan
        course_positions = {}
        position = 0
        
        for year in ["freshman", "sophomore", "junior", "senior"]:
            for term in ["fall", "winter", "spring"]:
                if year not in self.requirements["year_plan"] or term not in self.requirements["year_plan"][year]:
                    continue
                
                for course_info in self.requirements["year_plan"][year][term]:
                    course = course_info["course"]
                    
                    # Handle alternative courses like "CS 214 or 211" -> ["CS 214", "CS 211"]
                    alternatives = self._parse_alternative_courses(course)
                    
                    for alt_course in alternatives:
                        if alt_course not in course_positions:
                            course_positions[alt_course] = position
                            course_order.append(alt_course)
                    
                    position += 1
        
        return course_order
    
    def _process_taken_courses(self):
        """Process courses already taken by the student"""
        # Create lookup set for taken courses
        for course in self.taken_courses:
            subject = course["subject"]
            number = course["course_number"]
            
            # Remove any trailing '-0' to match requirements format
            if number.endswith("-0"):
                number = number[:-2]
            
            std_code = self._standardize_course_code(subject, number)
            
            # Mark course as processed
            self.processed_courses.add(std_code)
            
            # Also mark alternatives as processed
            # For example, if CS 111 is taken, mark "CS 111 or 150" as processed
            for year in self.requirements["year_plan"]:
                for term in self.requirements["year_plan"][year]:
                    for course_info in self.requirements["year_plan"][year][term]:
                        course_str = course_info["course"]
                        if " or " in course_str:
                            alternatives = self._parse_alternative_courses(course_str)
                            if std_code in alternatives:
                                # Mark the whole alternative as processed
                                self.processed_courses.add(course_str)
                                break
            # Remove from requirements
            self._remove_course_from_requirements(std_code)
    
    def _remove_course_from_requirements(self, std_code):
        """Remove a course from remaining requirements"""
        # Remove from year plan
        for year in self.remaining_requirements["year_plan"]:
            for term in self.remaining_requirements["year_plan"][year]:
                courses = self.remaining_requirements["year_plan"][year][term]
                for i, course_info in enumerate(courses):
                    course_str = course_info["course"]
                    
                    # Direct match
                    if course_str == std_code:
                        self.remaining_requirements["year_plan"][year][term].pop(i)
                        return
                    
                    # Check for alternatives
                    if " or " in course_str:
                        alternatives = self._parse_alternative_courses(course_str)
                        if std_code in alternatives:
                            self.remaining_requirements["year_plan"][year][term].pop(i)
                            return
    
    def _build_course_graph(self):
        """Build dependency graph for courses"""
        # Add all remaining courses as nodes
        for year in self.remaining_requirements["year_plan"]:
            for term in self.remaining_requirements["year_plan"][year]:
                for course_info in self.remaining_requirements["year_plan"][year][term]:
                    course_str = course_info["course"]
                    
                    # If we have alternatives, add each one separately
                    if " or " in course_str:
                        alternatives = self._parse_alternative_courses(course_str)
                        for alt in alternatives:
                            self.course_graph.add_node(alt)
                    else:
                        self.course_graph.add_node(course_str)
        
        # Add prerequisite edges
        self._add_cs_prerequisite_edges()
        
        # Add ordering constraints based on year/term
        self._add_term_ordering_edges()
    
    def _add_cs_prerequisite_edges(self):
        """Add prerequisite edges for CS courses"""
        # Common CS prerequisites
        prerequisites = {
            "CS 211": ["CS 111", "CS 150", "CS 214"],
            "CS 212": ["CS 211"],
            "CS 213": ["CS 211"],
            "CS 214": ["CS 111", "CS 150"],
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
                    course_str = course_info["course"]
                    
                    # Handle alternatives
                    if " or " in course_str:
                        alternatives = self._parse_alternative_courses(course_str)
                        for alt in alternatives:
                            course_term_map[alt] = term_value
                    else:
                        course_term_map[course_str] = term_value
        
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
        current_year, current_term = self.student_year, self.student_term

        for year in self.schedule:
            for term in self.schedule[year]:
                self.schedule[year][term] = [
                    course_info for course_info in self.schedule[year][term]
                    if course_info["course"] not in self.processed_courses
                ]

        try:
            topological_order = list(nx.topological_sort(self.course_graph))
            course_order = sorted(
                topological_order,
                key=lambda course: self.original_course_order.index(course)
                if course in self.original_course_order else float('inf')
            )
        except nx.NetworkXUnfeasible:
            print("Warning: Circular dependencies detected in course requirements")
            course_order = sorted(
                list(self.course_graph.nodes()),
                key=lambda course: self.original_course_order.index(course)
                if course in self.original_course_order else float('inf')
            )

        course_order = [c for c in course_order if c not in self.processed_courses]
        return self._assign_courses_to_terms(course_order, current_year, current_term)

    def _identify_current_position(self):
        """Identify student's current position in the program"""
        # Count courses taken by year and term
        year_term_counts = defaultdict(int)
        
        for year in self.requirements["year_plan"]:
            for term in self.requirements["year_plan"][year]:
                for course_info in self.requirements["year_plan"][year][term]:
                    course_str = course_info["course"]
                    
                    # Handle alternatives
                    alternatives = self._parse_alternative_courses(course_str)
                    
                    # Check if any of the alternatives is in processed_courses
                    if any(alt in self.processed_courses for alt in alternatives) or course_str in self.processed_courses:
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
            
            # Sort assignable courses by their original position in the plan
            # This ensures we follow the original order when possible
            assignable_courses.sort(
                key=lambda course: self.original_course_order.index(course) 
                if course in self.original_course_order else float('inf')
            )
            
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
            if term_units >= max_units_per_term or len(assignable_courses) == 0:
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
        req_cats = self.requirements.get("requirement_categories", {})

        cs_breadth_req = 5
        tech_elec_req = 3
        theme_req = 7
        basic_eng_req = 5
        unrestricted_req = 5
        project_req = 2
        basic_sci_req = 4

        if req_cats:
            if "cs_requirements" in req_cats:
                cs_reqs = req_cats["cs_requirements"]
                if "cs_breadth" in cs_reqs:
                    cs_breadth_req = cs_reqs["cs_breadth"].get("total_required", 5)
                if "technical_electives" in cs_reqs:
                    tech_elec_req = cs_reqs["technical_electives"].get("total_required", 3)
                if "project_courses" in cs_reqs:
                    project_req = cs_reqs["project_courses"].get("total_required", 2)

            if "theme_courses" in req_cats:
                theme_req = req_cats["theme_courses"].get("total_required", 7)

            if "basic_engineering" in req_cats:
                basic_eng_req = req_cats["basic_engineering"].get("total_required", 5)

            if "unrestricted_electives" in req_cats:
                unrestricted_req = req_cats["unrestricted_electives"].get("total_required", 5)

            if "basic_sciences" in req_cats:
                basic_sci_req = req_cats["basic_sciences"].get("total_required", 4)

        remaining = {
            "CS Breadth": cs_breadth_req - assigned_requirements["cs_breadth"],
            "Tech Elect": tech_elec_req - assigned_requirements["tech_electives"],
            "Theme": theme_req - assigned_requirements["theme"],
            "Basic Eng": basic_eng_req - assigned_requirements["basic_eng"],
            "Unrestricted": unrestricted_req - assigned_requirements["unrestricted"],
            "Project": project_req - assigned_requirements["project"],
            "Basic Science w/ Lab": basic_sci_req - assigned_requirements["basic_science"]
        }

        terms = ["fall", "winter", "spring"]
        years = ["freshman", "sophomore", "junior", "senior"]

        for year in years:
            for term in terms:
                if len(schedule.get(year, {}).get(term, [])) >= 4:
                    continue

                available_units = 4 - len(schedule[year][term])

                for req_type, rem in remaining.items():
                    while rem > 0 and available_units > 0:
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
                        else:
                            index = assigned_requirements["unrestricted"] + 1
                            course_name = f"Unrestricted ({index})"

                        schedule[year][term].append({
                            "course": course_name,
                            "units": 1
                        })

                        rem -= 1
                        available_units -= 1
                        assigned_requirements[req_type.lower().replace(" ", "_")] += 1

                if all(val <= 0 for val in remaining.values()) and available_units > 0:
                    for _ in range(available_units):
                        schedule[year][term].append({
                            "course": "Open Slot",
                            "units": 1
                        })

    def generate_recommendation_report(self):
        """Generate a comprehensive report of the recommended schedule"""
        schedule = self.generate_schedule()
        
        # Print debug info about processed courses
        # print("Processed courses:", self.processed_courses)
        # Calculate the total credits earned from the "earned" field in taken_courses
        taken_courses_count = sum(float(course.get("earned", 0)) for course in self.taken_courses)
        
        report = {
            "student_progress": {
                "courses_required": 48,
                # ENGL 106-1 and DSGN 106-1 are count as 1 course and ENGL 106-2 and DSGN 106-2 are count as 1 course
                "courses_taken": len(self.processed_courses) - 2,
                "courses_completed": taken_courses_count,
                "courses_remaining": 48 - taken_courses_count,
                
            },
            "recommended_schedule": schedule,
            "notes": []
        }
        
        # Add notes about CS sequence
        if "CS 211" not in self.processed_courses:
            report["notes"].append("Note: CS 211 is a prerequisite for many upper-level CS courses.")
        
        # Add notes about breadth requirements
        req_cats = self.requirements.get("requirement_categories", {})
        cs_breadth_req = 5  # Default
        if "cs_requirements" in req_cats and "cs_breadth" in req_cats["cs_requirements"]:
            cs_breadth_req = req_cats["cs_requirements"]["cs_breadth"].get("total_required", 5)
        report["notes"].append(f"Complete all {cs_breadth_req} CS breadth courses to fulfill degree requirements.")
        
        # Add notes about theme courses
        theme_req = 7  # Default
        if "theme_courses" in req_cats:
            theme_req = req_cats["theme_courses"].get("total_required", 7)
        report["notes"].append(f"Theme courses ({theme_req} required) should form a coherent sequence in humanities/social sciences.")
        
        # Add note about technical electives
        tech_elec_req = 3  # Default
        if "cs_requirements" in req_cats and "technical_electives" in req_cats["cs_requirements"]:
            tech_elec_req = req_cats["cs_requirements"]["technical_electives"].get("total_required", 3)
        report["notes"].append(f"Choose {tech_elec_req} technical electives based on your interests and career goals.")
        
        return report