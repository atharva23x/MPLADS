import os
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")

LOK_CSV = os.path.join(DATA_DIR, "lok_results.csv")
RAJYA_CSV = os.path.join(DATA_DIR, "rajya_results.csv")
GEOJSON_PATH = os.path.join(DATA_DIR, "geo", "india_states.geojson")

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

GEMINI_MODEL = "gemini-3.6-flash"

PORT = int(os.environ.get("PORT", 5000))


# Standardize state names so they join onto the public India GeoJSON (ST_NM)
STATE_NAME_MAPPING = {
    "Andaman And Nicobar Islands": "Andaman & Nicobar Island",
    "Delhi": "NCT of Delhi",
    "Jammu And Kashmir": "Jammu & Kashmir",
    "The Dadra And Nagar Haveli And Daman And Diu": "Dadara & Nagar Havelli",
    "Arunachal Pradesh": "Arunanchal Pradesh",
}
