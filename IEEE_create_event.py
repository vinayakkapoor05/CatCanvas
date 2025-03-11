from googleapiclient.discovery import build

from google.oauth2 import service_account

# Authenticate using a service account
SCOPES = ['https://www.googleapis.com/auth/calendar']
SERVICE_ACCOUNT_FILE = 'path/to/service-account.json'  # Replace with actual file path

credentials = service_account.Credentials.from_service_account_file(
    SERVICE_ACCOUNT_FILE, scopes=SCOPES
)

service = build('calendar', 'v3', credentials=credentials)

# Arguments received from Romir's function
def create_event(event_name, location, description, start_date_and_time, end_date_and_time, timezone):
    event = {
        'summary': event_name,
        'location': location,
        'description': description,
        'start': {
            'dateTime': start_date_and_time,
            'timeZone': timezone
        },
        'end': {
            'dateTime': end_date_and_time,  
            'timeZone': timezone
        },
        'attendees': [
            # NEED??
            {'email': 'example@example.com'}
        ],
        'reminders': {
            'useDefault': False,
            'overrides': [
                {'method': 'email', 'minutes': 24 * 60},
                {'method': 'popup', 'minutes': 10}
            ]
        }
    }

    event_result = service.events().insert(calendarId='primary', body=event).execute()
    
    print(f"Event created: {event_result.get('htmlLink')}")

    # FORMAT FOR EXAMPLE
    # var event = {
    #     'summary': 'Sample Event',
    #     'location': '123 Main St, Anytown, USA',
    #     'description': 'A sample event created via Google Calendar API.',
    #     'start': {
    #         'dateTime': '2023-10-01T09:00:00-07:00',
    #         'timeZone': 'America/Los_Angeles'
    #     },
    #     'end': {
    #         'dateTime': '2023-10-01T17:00:00-07:00',
    #         'timeZone': 'America/Los_Angeles'
    #     },
    #     'attendees': [
    #         {'email': 'example@example.com'}
    #     ],
    #     'reminders': {
    #         'useDefault': false,
    #         'overrides': [
    #             {'method': 'email', 'minutes': 24 * 60},
    #             {'method': 'popup', 'minutes': 10}
    #         ]