import os
import glob
import logging
import json
import numpy as np
import faiss
import openai
from fastapi import FastAPI, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import re
load_dotenv()


BASE_DIR           = os.path.dirname(__file__)
PLAN_SOURCE_DIR    = os.path.join(BASE_DIR, "plan_data")
PLAN_INDEX_PATH    = os.path.join(BASE_DIR, "plan_faiss.index")
PLAN_META_PATH     = os.path.join(BASE_DIR, "plan_meta.npy")
plan_index         = None
plan_id_to_meta    = {}
plan_next_doc_id   = 0


OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise RuntimeError("Missing OPENAI_API_KEY environment variable")
openai.api_key = OPENAI_API_KEY

BASE_DIR    = os.path.dirname(__file__)
SOURCE_DIR  = os.path.join(BASE_DIR, "data", "txts")  
DIM         = 1536
INDEX_PATH  = os.path.join(BASE_DIR, "canvas_faiss.index")
META_PATH   = os.path.join(BASE_DIR, "canvas_meta.npy")

index            = None
id_to_meta       = {}
next_doc_id      = 0

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
security = HTTPBearer()

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> str:
    token = credentials.credentials
    if not token:
        raise HTTPException(401, "Invalid or missing token")
    return token

def build_plan_index():
    global plan_index, plan_id_to_meta, plan_next_doc_id
    os.makedirs(PLAN_SOURCE_DIR, exist_ok=True)
    flat   = faiss.IndexFlatL2(DIM)
    mapper = faiss.IndexIDMap2(flat)
    meta   = {}
    did    = 0

    # scan all .txt (or .json) in plan_data
    for path in glob.glob(os.path.join(PLAN_SOURCE_DIR, "*.*")):
        fn   = os.path.basename(path)
        text = open(path, encoding="utf-8").read()
        emb  = openai.embeddings.create(
                  input=text,
                  model="text-embedding-ada-002"
              ).data[0].embedding
        vec  = np.array(emb, dtype="float32").reshape(1, DIM)
        mapper.add_with_ids(vec, np.array([did], dtype="int64"))
        meta[did] = {"source_file": fn}
        did += 1

    faiss.write_index(mapper, PLAN_INDEX_PATH)
    np.save(PLAN_META_PATH, meta)
    plan_index       = mapper
    plan_id_to_meta  = meta
    plan_next_doc_id = did
    return did

def build_faiss_index():
    global index, id_to_meta, next_doc_id
    os.makedirs(SOURCE_DIR, exist_ok=True)
    flat   = faiss.IndexFlatL2(DIM)
    mapper = faiss.IndexIDMap2(flat)
    meta   = {}
    did    = 0

    for path in glob.glob(os.path.join(SOURCE_DIR, "*.txt")):
        fn   = os.path.basename(path)
        text = open(path, encoding="utf-8").read()
        emb  = openai.embeddings.create(input=text, model="text-embedding-ada-002").data[0].embedding
        vec  = np.array(emb, dtype="float32").reshape(1, DIM)
        mapper.add_with_ids(vec, np.array([did], dtype="int64"))
        meta[did] = {"source_file": fn}
        did += 1

    faiss.write_index(mapper, INDEX_PATH)
    np.save(META_PATH, meta)
    index       = mapper
    id_to_meta  = meta
    next_doc_id = did
    return did

@app.on_event("startup")
def startup():
    global index, id_to_meta, next_doc_id
    global plan_index, plan_id_to_meta, plan_next_doc_id

    os.makedirs(SOURCE_DIR, exist_ok=True)

    if os.path.exists(INDEX_PATH) and os.path.exists(META_PATH):
        index       = faiss.read_index(INDEX_PATH)
        id_to_meta  = np.load(META_PATH, allow_pickle=True).item()
        next_doc_id = max(id_to_meta.keys(), default=-1) + 1
    else:
        index       = faiss.IndexIDMap2(faiss.IndexFlatL2(DIM))
        id_to_meta  = {}
        next_doc_id = 0

    os.makedirs(PLAN_SOURCE_DIR, exist_ok=True)
    if os.path.exists(PLAN_INDEX_PATH) and os.path.exists(PLAN_META_PATH):
        plan_index       = faiss.read_index(PLAN_INDEX_PATH)
        plan_id_to_meta  = np.load(PLAN_META_PATH, allow_pickle=True).item()
        plan_next_doc_id = max(plan_id_to_meta.keys(), default=-1) + 1
    else:
        plan_index       = faiss.IndexIDMap2(faiss.IndexFlatL2(DIM))
        plan_id_to_meta  = {}
        plan_next_doc_id = 0

    if plan_next_doc_id == 0:
        # only build if there was no saved index
        cnt = build_plan_index()
        logging.info(f"Plan index built with {cnt} docs from {PLAN_SOURCE_DIR}")


class BuildRequest(BaseModel):
    overwrite: bool = False

class UploadRequest(BaseModel):
    docs: dict

class PlanUploadRequest(BaseModel):
    courses: dict


class QueryRequest(BaseModel):
    query: str
    top_k: int = 5

class ChatRequest(BaseModel):
    query: str
    top_k: int = 5

@app.post("/api/rag/build")
async def rebuild(req: BuildRequest, user: str = Depends(get_current_user)):
    if req.overwrite or not os.path.exists(INDEX_PATH):
        cnt = build_faiss_index()
        return {"status": "rebuilt", "documents_indexed": cnt}
    return {"status": "skipped", "reason": "index exists"}

@app.post("/api/rag/upload")
async def upload_docs(req: UploadRequest, user: str = Depends(get_current_user)):
    """
    Accepts:
      {
        "docs": {
          "12345": {
             "pages": { "slug1": "text…", "slug2": "text…" },
             "syllabus": "…"
          },
          "67890": { "slugA": "text…", "slugB": "text…" }
        }
      }
    Handles both nested ({pages, syllabus}) and flat ({slug: text, syllabus: text}) shapes.
    """
    global index, id_to_meta, next_doc_id
    os.makedirs(SOURCE_DIR, exist_ok=True)
    count = 0

    for course_id, obj in req.docs.items():
        pages       = {}
        syllabus_txt = None

        if isinstance(obj, dict):
            raw_syl = obj.get("syllabus")
            if isinstance(raw_syl, dict):
                syllabus_txt = raw_syl.get("content")
            else:
                syllabus_txt = raw_syl

            if "pages" in obj and isinstance(obj["pages"], dict):
                pages = obj["pages"]
            else:
                pages = {k: v for k, v in obj.items() if k != "syllabus"}
        for slug, text in (pages or {}).items():
            fn   = f"{course_id}_{slug}.txt"
            path = os.path.join(SOURCE_DIR, fn)
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)

            emb  = openai.embeddings.create(input=text, model="text-embedding-ada-002").data[0].embedding
            vec  = np.array(emb, dtype="float32").reshape(1, DIM)
            index.add_with_ids(vec, np.array([next_doc_id], dtype="int64"))
            id_to_meta[next_doc_id] = {"source_file": fn}
            next_doc_id += 1
            count += 1

        if syllabus_txt:
            fn   = f"{course_id}_syllabus.txt"
            path = os.path.join(SOURCE_DIR, fn)
            with open(path, "w", encoding="utf-8") as f:
                f.write(syllabus_txt)

            emb  = openai.embeddings.create(input=syllabus_txt, model="text-embedding-ada-002").data[0].embedding
            vec  = np.array(emb, dtype="float32").reshape(1, DIM)
            index.add_with_ids(vec, np.array([next_doc_id], dtype="int64"))
            id_to_meta[next_doc_id] = {"source_file": fn}
            next_doc_id += 1
            count += 1

    faiss.write_index(index, INDEX_PATH)
    np.save(META_PATH, id_to_meta)
    return {"indexed": count}

@app.post("/api/rag/query")
async def query_rag(req: QueryRequest, user: str = Depends(get_current_user)):
    if index is None:
        raise HTTPException(400, "Index not built.")
    emb = openai.embeddings.create(input=req.query, model="text-embedding-ada-002").data[0].embedding
    qv  = np.array(emb, dtype="float32").reshape(1, DIM)
    dists, ids = index.search(qv, req.top_k)
    return {"results": [{"id": int(i), **id_to_meta.get(i, {})} for i in ids[0]]}

from fastapi.responses import StreamingResponse

from fastapi.responses import StreamingResponse
import asyncio

@app.post("/api/rag/chat")
async def chat_rag(req: ChatRequest, user: str = Depends(get_current_user)):
    if index is None:
        raise HTTPException(400, "Index not built.")
    
    try:
        # Get embeddings for the query
        emb = openai.embeddings.create(input=req.query, model="text-embedding-ada-002").data[0].embedding
        qv  = np.array(emb, dtype="float32").reshape(1, DIM)
        _, ids = index.search(qv, req.top_k)

        # Retrieve the relevant documents
        docs = []
        for i in ids[0]:
            meta = id_to_meta.get(i)
            if not meta: continue
            fn   = meta.get("source_file")
            path = os.path.join(SOURCE_DIR, fn)
            if fn and os.path.isfile(path):
                docs.append(open(path, encoding="utf-8").read())

        if not docs:
            return {"response": "No documents found for this query."}

        context = "\n---\n".join(docs)
        system  = {"role": "system", "content": "You are a helpful assistant for Canvas."}
        user_m  = {"role": "user",   "content": f"Context:\n{context}\n\nQ: {req.query}"}

        async def generate():
            try:
                stream = openai.chat.completions.create(
                    model="gpt-3.5-turbo",
                    messages=[system, user_m],
                    stream=True
                )
                
                for chunk in stream:
                    if hasattr(chunk.choices[0].delta, 'content') and chunk.choices[0].delta.content is not None:
                        yield chunk.choices[0].delta.content
                        await asyncio.sleep(0.01)
            except Exception as e:
                logging.error(f"Error in generate stream: {str(e)}")
                yield f"\nError generating response: {str(e)}"

        return StreamingResponse(
            generate(),
            media_type="text/plain",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no"  
            }
        )
    
    except Exception as e:
        logging.error(f"Chat RAG error: {str(e)}")
        raise HTTPException(500, f"Error processing request: {str(e)}")


@app.post("/api/plan/upload")
async def plan_upload(req: PlanUploadRequest, user: str = Depends(get_current_user)):
    """
    Accepts:
      { "courses": { currentCourses: [...], pastCourses: [...] } }
    Embeds the entire JSON blob as one document into plan_index.
    """
    global plan_index, plan_id_to_meta, plan_next_doc_id
    os.makedirs(PLAN_SOURCE_DIR, exist_ok=True)

    # 1) Serialize your blob as text
    text = json.dumps(req.courses)

    # 2) Save the raw JSON (optional)
    fn = f"scraped_{plan_next_doc_id}.json"
    path = os.path.join(PLAN_SOURCE_DIR, fn)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)

    # 3) Embed + index
    emb = openai.embeddings.create(input=text, model="text-embedding-ada-002")\
                           .data[0].embedding
    vec = np.array(emb, dtype="float32").reshape(1, DIM)
    plan_index.add_with_ids(vec, np.array([plan_next_doc_id], dtype="int64"))
    plan_id_to_meta[plan_next_doc_id] = {"source_file": fn}
    plan_next_doc_id += 1

    # 4) Persist your new index
    faiss.write_index(plan_index, PLAN_INDEX_PATH)
    np.save(PLAN_META_PATH, plan_id_to_meta)

    return {"indexed": 1}


@app.post("/api/plan/chat")
async def plan_chat(req: ChatRequest, user: str = Depends(get_current_user)):
    if plan_index is None:
        raise HTTPException(400, "Plan index not built.")
    # embed the query
    emb = openai.embeddings.create(input=req.query, model="text-embedding-ada-002")\
                           .data[0].embedding
    qv  = np.array(emb, dtype="float32").reshape(1, DIM)
    _, ids = plan_index.search(qv, req.top_k)

    # pull down that one big JSON document (or however many you’ve indexed)
    docs = []
    for i in ids[0]:
        meta = plan_id_to_meta.get(i)
        if not meta: continue
        fn = meta["source_file"]
        p  = os.path.join(PLAN_SOURCE_DIR, fn)
        if os.path.isfile(p):
            docs.append(open(p, encoding="utf-8").read())

    if not docs:
        return {"response": "No plan data indexed yet."}

    context = "\n---\n".join(docs)
    system = {"role":"system","content":"You are an academic advisor for course planning."}
    user_m = {"role":"user","content":f"Context:\n{context}\n\nQ: {req.query}"}

    # stream the answer back
    async def gen():
        try:
            stream = openai.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[system, user_m],
                stream=True
            )
            for chunk in stream:
                delta = chunk.choices[0].delta
                # use attribute access instead of dict.get()
                if getattr(delta, "content", None):
                    yield delta.content
                    await asyncio.sleep(0.01)
        except Exception as e:
            logging.error(f"Error in generate stream: {e}")
            yield f"\nError generating response: {e}"

    return StreamingResponse(gen(), media_type="text/plain")


logging.basicConfig(level=logging.INFO)

@app.post("/api/rag/deadlines")
async def extract_deadlines(user: str = Depends(get_current_user)):
    if index is None:
        raise HTTPException(400, "Index not built.")

    courses = {}
    for doc_id, meta in id_to_meta.items():
        fn = meta["source_file"]
        m = re.match(r"(\d+)_", fn)
        if not m:
            continue
        cid = m.group(1)
        courses.setdefault(cid, []).append(fn)

    results = {}

    for cid, files in courses.items():
        texts = []
        for fn in files:
            path = os.path.join(SOURCE_DIR, fn)
            if os.path.isfile(path):
                texts.append(open(path, encoding="utf-8").read())
        context = "\n---\n".join(texts)

        prompt = (
            "Extract all exam or assignment deadlines from the following syllabus/pages.  "
            "For each item, give:\n"
            "  - title (e.g. “Midterm Exam 1”, “Problem Set 3”) \n"
            "  - due_date (ISO format YYYY-MM-DD if possible)  \n"
            "  - type (“exam” or “assignment”)\n"
            "Return a JSON array only, e.g.:\n"
            '[ { "title": "...", "due_date": "...", "type": "..." }, … ]\n\n'
            f"CONTEXT:\n{context}"
        )

        resp = openai.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "You are a helpful assistant for parsing deadlines."},
                {"role": "user",   "content": prompt},
            ],
            temperature=0.0
        )
        raw = resp.choices[0].message.content.strip()

        cleaned = re.sub(r"^```(?:json)?\s*", "", raw)       
        cleaned = re.sub(r"\s*```$", "", cleaned)           
        cleaned = cleaned.strip()

        try:
            deadlines_list = json.loads(cleaned)
        except json.JSONDecodeError as e:
            logging.error(f"[{cid}] JSON parse error: {e}")
            logging.error(f"[{cid}] raw response:\n{raw}")
            logging.error(f"[{cid}] cleaned content:\n{cleaned}")
            deadlines_list = []

        logging.info(f"Deadlines for course {cid}: {json.dumps(deadlines_list, indent=2)}")

        results[cid] = deadlines_list
        calendar = get_calendar_service(user)

        for cid, deadlines in results.items():
            for item in deadlines:
                if not item.get("due_date"):
                    continue

                event = {
                    "summary": f"{item['title']} ({item['type']})",
                    "start": {"date": item["due_date"]},
                    "end":   {"date": item["due_date"]},
                    "description": f"Auto-added from Canvas course {cid}"
                }
                try:
                    calendar.events().insert(calendarId='primary', body=event).execute()
                except Exception as e:
                    logging.error(f"Failed to create event for {cid} {item}: {e}")

        return {"scheduled": results}



from fastapi import Request
from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
def get_calendar_service(user: str):
    tok = user_tokens.get(user)
    if not tok:
        raise HTTPException(401, "User not authorized with Google Calendar")
    creds = Credentials(
        tok["token"],
        refresh_token=tok["refresh_token"],
        token_uri=tok["token_uri"],
        client_id=tok["client_id"],
        client_secret=tok["client_secret"],
        scopes=tok["scopes"]
    )
    return build('calendar', 'v3', credentials=creds)

GOOGLE_OAUTH2_CLIENT_SECRETS = os.path.join(BASE_DIR, 'credentials.json')
SCOPES = ['https://www.googleapis.com/auth/calendar.events']

user_tokens = {}
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi import status
from fastapi.responses import JSONResponse

@app.get("/oauth2status")
async def oauth2_status(user: str = Depends(get_current_user)):
    connected = user in user_tokens
    return JSONResponse(
        {"connected": connected},
        status_code=status.HTTP_200_OK
    )

@app.get("/oauth2init")
async def oauth2_init(user: str = Depends(get_current_user)):
    flow = Flow.from_client_secrets_file(
        GOOGLE_OAUTH2_CLIENT_SECRETS,
        scopes=SCOPES,
        redirect_uri="http://localhost:8000/oauth2callback"
    )
    auth_url, _ = flow.authorization_url(
        access_type='offline',
        prompt='consent',
        state=user
    )
    return JSONResponse({"auth_url": auth_url})



from fastapi import Query
from fastapi import Depends
from fastapi import Request
from fastapi import HTTPException
from fastapi.responses import HTMLResponse

@app.get("/oauth2callback")
async def oauth2_callback(
    request: Request,
    state: str = Query(...)    
):
    flow = Flow.from_client_secrets_file(
        GOOGLE_OAUTH2_CLIENT_SECRETS,
        scopes=SCOPES,
        redirect_uri="http://localhost:8000/oauth2callback"
    )
    flow.fetch_token(code=request.query_params.get('code'))
    creds = flow.credentials

    user_tokens[state] = {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": creds.scopes
    }

    return HTMLResponse("""
      <p>Calendar connected! You can now return to the extension and sync.</p>
      <script>window.close()</script>
    """)

