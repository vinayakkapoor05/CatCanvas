This extension grabs all the text from a canvas file and querys an llm with the users questions about them

1.) Right now I am using local chrome cache storage but that means you have to scraoe every time. The scraped text should be stored in aws

2.) I am currently using a free llm with a 32k token input limit however even after cleanig all of the text fro whitespace there are around 128k tokens so either we need a different kanguage model with a higher limit or a way to recursively summarize information without losing meaning to condense and clean the text

