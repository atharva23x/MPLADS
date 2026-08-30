import pandas as pd
import numpy as np
import plotly.express as px
import matplotlib.pyplot as plt
import geopandas as gpd
from matplotlib.colors import ListedColormap
import matplotlib.patches as mpatches
import requests
from sklearn.ensemble import IsolationForest
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import RobustScaler
from sklearn.pipeline import make_pipeline
from google import genai
import os
from dotenv import load_dotenv

load_dotenv()

# config from environment variable
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None
# ============================================================
# 1. LOAD DATA
# ============================================================

FILE = "Rajya Sabha.xlsx"

data = pd.read_excel(FILE,sheet_name="Merged Works")

print("Original dataset shape:", data.shape)

print("\nColumns:")
print(data.columns.tolist())

# 2. CLEAN COLUMN NAMES
data.columns = data.columns.str.strip()

# ============================================================
# 3. CONVERT NUMERIC COLUMNS
# ============================================================

money_columns = [
    'Sanction Amount ( ₹ )',
    'Amount Disbursed ( ₹ )',
    'Fund Disbursed Amount ( ₹ )'
]

for col in money_columns:
    data[col] = pd.to_numeric(data[col],errors='coerce')


# ============================================================
# 4. CONVERT DATE COLUMNS
# ============================================================

date_columns = [
    'Recommended date',
    'Sanction Date',
    'Completion Date',
    'Expenditure Date'
]

for col in date_columns:
    data[col] = pd.to_datetime(data[col],errors='coerce')


# ============================================================
# 5. BASIC DATA QUALITY CHECK
# ============================================================

print("\nMissing values:")
print(data[money_columns + date_columns].isna().sum())

print("\nDuplicate Work IDs:")  #probably because of 
print(data['Work ID'].duplicated().sum())


# ============================================================
# 6. PAYMENT RECORD COUNT
# ============================================================

# Every row is treated as a payment/expenditure record
data['payment_record'] = 1

# ============================================================
# 7. AGGREGATE TO WORK LEVEL
# ============================================================

work_data = data.groupby('Work ID',dropna=False
).agg({

    # Financial
    'Sanction Amount ( ₹ )': 'first',
    'Amount Disbursed ( ₹ )': 'first',
    'Fund Disbursed Amount ( ₹ )': 'sum',

    # Dates
    'Recommended date': 'first',
    'Sanction Date': 'first',
    'Completion Date': 'first',
    'Expenditure Date': 'first',

    # Work information
    'Work': 'first',
    'Work Category': 'first',
    'Work Description': 'first',
    'State': 'first',
    'IDA': 'first',
    "Hon'ble Members of Parliament": 'first',

    # Vendor/payment
    'Vendor Name': 'first',
    'Payment Status': 'first',
    'Work Status': 'first',

    # Number of records
    'payment_record': 'sum'

}).reset_index()


# Rename payment count
work_data.rename(columns={'payment_record': 'payment_count'},inplace=True)

print("\nWork-level dataset shape:")
print(work_data.shape)


# ============================================================
# 8. FINANCIAL FEATURES
# ============================================================

# Avoid division by zero
sanction = work_data['Sanction Amount ( ₹ )'].replace(0, np.nan)
amount = work_data['Amount Disbursed ( ₹ )'].replace(0, np.nan)

# Fund disbursed / sanctioned amount
work_data['expenditure_ratio'] = (work_data['Fund Disbursed Amount ( ₹ )'] /sanction)

# Amount disbursed / sanctioned amount
work_data['amount_ratio'] = (work_data['Amount Disbursed ( ₹ )'] /sanction)

# Remaining amount
work_data['unspent_amount'] = (work_data['Sanction Amount ( ₹ )'] -work_data['Fund Disbursed Amount ( ₹ )'])

# Amount exceeding sanction
work_data['expenditure_overrun'] = ( work_data['Fund Disbursed Amount ( ₹ )'] -work_data['Sanction Amount ( ₹ )']).clip(lower=0)

# Amount disbursed exceeding sanction
work_data['disbursement_overrun'] = (
    work_data['Amount Disbursed ( ₹ )'] -work_data['Sanction Amount ( ₹ )']).clip(lower=0)


# ============================================================
# 9. TIME FEATURES
# ============================================================

work_data['recommendation_to_sanction_days'] = (work_data['Sanction Date'] -work_data['Recommended date']).dt.days

work_data['sanction_to_expenditure_days'] = (work_data['Expenditure Date'] -work_data['Sanction Date']).dt.days

work_data['sanction_to_completion_days'] = (work_data['Completion Date'] -work_data['Sanction Date']).dt.days

work_data['duration_days'] = (work_data['Completion Date'] -work_data['Sanction Date']).dt.days


# ============================================================
# 10. DELAY FEATURES
# ============================================================

# Assuming 365 days as initial threshold.
work_data['delay_days'] = (work_data['duration_days'] - 365).clip(lower=0)

work_data['is_delayed'] = (work_data['duration_days'] > 365).astype(int)


# ============================================================
# 11. PAYMENT FEATURES
# ============================================================

work_data['average_payment'] = (
    work_data['Fund Disbursed Amount ( ₹ )'] /work_data['payment_count'].replace(0, np.nan))


# ============================================================
# 12. STATUS-BASED FEATURES
# ============================================================

# Completed work
work_data['is_completed'] = (work_data['Completion Date'].notna()).astype(int)

# Expenditure but no completion date
work_data['spend_without_completion'] = (
    (work_data['Fund Disbursed Amount ( ₹ )'] > 0) & (work_data['Completion Date'].isna())).astype(int)

# High expenditure but incomplete
work_data['high_spend_incomplete'] = (
    (work_data['expenditure_ratio'] >= 0.80) & (work_data['Completion Date'].isna())).astype(int)


# ============================================================
# 13. PAYMENT STATUS FEATURES
# ============================================================

work_data['payment_status_missing'] = (work_data['Payment Status'].isna()).astype(int)


# ============================================================
# 14. DUPLICATE WORK DETECTION
# ============================================================

# Normalize description
work_data['description_clean'] = (work_data['Work Description'].fillna('').astype(str).str.lower().str.strip())

# Normalize work name
work_data['work_clean'] = (work_data['Work'].fillna('').astype(str).str.lower().str.strip())

# Exact duplicate description
description_counts = (work_data['description_clean'].value_counts())


work_data['duplicate_description'] = (work_data['description_clean'].map(description_counts).fillna(0)> 1).astype(int)

location_description_counts = (work_data['duplicate_description'].value_counts())

work_data['possible_duplicate_work'] = (
    work_data['duplicate_description'].map(location_description_counts).fillna(0)> 1).astype(int)


# ============================================================
# 15. DATA CONSISTENCY / COMPLIANCE RULES
# ============================================================

# Expenditure exceeds sanction
work_data['rule_expenditure_over_sanction'] = (
    work_data['expenditure_ratio'] > 1).astype(int)

# Amount disbursed exceeds sanction
work_data['rule_disbursement_over_sanction'] = (
    work_data['amount_ratio'] > 1).astype(int)


# Completion before sanction
work_data['rule_completion_before_sanction'] = (
    work_data['Completion Date'] <work_data['Sanction Date']).fillna(False).astype(int)


# Expenditure before sanction
work_data['rule_expenditure_before_sanction'] = (
    work_data['Expenditure Date'] <work_data['Sanction Date']).fillna(False).astype(int)

# Recommendation after sanction
work_data['rule_recommendation_after_sanction'] = (
    work_data['Recommended date'] >work_data['Sanction Date']).fillna(False).astype(int)


# ============================================================
# 16. ML FEATURES
# ============================================================

features = [
    # Financial
    'Sanction Amount ( ₹ )',
    'Amount Disbursed ( ₹ )',
    'Fund Disbursed Amount ( ₹ )',
    'expenditure_ratio',
    'amount_ratio',
    'unspent_amount',
    'expenditure_overrun',
    'disbursement_overrun',

    # Time
    'recommendation_to_sanction_days',
    'sanction_to_expenditure_days',
    'sanction_to_completion_days',
    'duration_days',
    'delay_days',

    # Payments
    'payment_count',
    'average_payment',

    # Status / risk indicators
    'is_delayed',
    'spend_without_completion',
    'high_spend_incomplete',

    # Duplicate indicators
    'duplicate_description',
    'possible_duplicate_work',

    # Compliance
    'rule_expenditure_over_sanction',
    'rule_disbursement_over_sanction',
    'rule_completion_before_sanction',
    'rule_expenditure_before_sanction',
    'rule_recommendation_after_sanction'
]


# ============================================================
# 17. PREPARE ML DATA
# ============================================================

X = work_data[features].copy()

X = X.replace([np.inf, -np.inf],np.nan)  # Convert infinity to missing

# ============================================================
# 18. IMPUTATION + ROBUST SCALING
# ============================================================

pipeline = make_pipeline(SimpleImputer(strategy='median'),RobustScaler())

X = pipeline.fit_transform(X)

# ============================================================
# 19. ISOLATION FOREST
# ============================================================

model = IsolationForest(n_estimators=300,contamination=0.05,random_state=42,n_jobs=-1)

work_data['model_prediction'] = (model.fit_predict(X))  #1:normal  -1:anomaly

work_data['Is Anomaly'] = (work_data['model_prediction'] == -1).astype(int)  #make separate column

work_data['anomaly_score'] = (model.decision_function(X))  # ANOMALY SCORE (Lower score = more anomalous)

# ============================================================
# 22. RULE-BASED ANOMALY REASONS
# ============================================================

work_data['Anomaly Reason'] = ''

# Financial
work_data.loc[
    work_data['rule_expenditure_over_sanction'] == 1,'Anomaly Reason'] += 'Expenditure exceeds sanction; '

work_data.loc[
    work_data['rule_disbursement_over_sanction'] == 1,'Anomaly Reason'] += 'Disbursement exceeds sanction; '

# Delay
work_data.loc[
    work_data['is_delayed'] == 1,'Anomaly Reason'] += 'Long completion duration; '

# High expenditure without completion
work_data.loc[
    work_data['high_spend_incomplete'] == 1,'Anomaly Reason'] += 'High spending but work incomplete; '

# Duplicate
work_data.loc[
    work_data['possible_duplicate_work'] == 1,'Anomaly Reason'] += 'Possible duplicate work; '


# Date problems
work_data.loc[
    work_data['rule_completion_before_sanction'] == 1,'Anomaly Reason'] += 'Completion before sanction date; '


work_data.loc[
    work_data['rule_expenditure_before_sanction'] == 1,'Anomaly Reason'] += 'Expenditure before sanction date; '


work_data.loc[
    work_data['rule_recommendation_after_sanction'] == 1,'Anomaly Reason'] += 'Recommendation after sanction date; '


# ============================================================
# 23. COMPLIANCE SCORE
# ============================================================

work_data['compliance_score'] = 100

# Deduct points for rule violations(penalty)

work_data.loc[work_data['rule_expenditure_over_sanction'] == 1,'compliance_score'] -= 30

work_data.loc[work_data['rule_disbursement_over_sanction'] == 1,'compliance_score'] -= 25

work_data.loc[work_data['is_delayed'] == 1,'compliance_score'] -= 15

work_data.loc[work_data['high_spend_incomplete'] == 1,'compliance_score'] -= 15

work_data.loc[work_data['possible_duplicate_work'] == 1,'compliance_score'] -= 15

work_data.loc[work_data['rule_completion_before_sanction'] == 1,'compliance_score'] -= 20

work_data.loc[work_data['rule_expenditure_before_sanction'] == 1,'compliance_score'] -= 20

work_data.loc[work_data['rule_recommendation_after_sanction'] == 1, 'compliance_score'] -= 10


# Don't allow score below zero
work_data['compliance_score'] = (work_data['compliance_score'].clip(lower=0))

# ============================================================
# 24. RISK LEVEL
# ============================================================

def calculate_risk(row):

    anomaly = row['Is Anomaly']
    score = row['compliance_score']

    if anomaly == 1 and score < 60:
        return 'HIGH'

    elif anomaly == 1 or score < 80:
        return 'MEDIUM'

    else:
        return 'LOW'


work_data['Risk Level'] = (work_data.apply(calculate_risk,axis=1))


# ============================================================
# 25. RISK ALERT
# ============================================================

work_data['Risk Alert'] = ''

work_data.loc[work_data['Risk Level'] == 'HIGH','Risk Alert'] = 'Immediate Review Required'

work_data.loc[work_data['Risk Level'] == 'MEDIUM','Risk Alert'] = 'Monitor / Verify'

work_data.loc[work_data['Risk Level'] == 'LOW','Risk Alert'] = 'No Immediate Action'


# ============================================================
# 26. RESULTS
# ============================================================

print("\n========================================")
print("MODEL RESULTS")
print("========================================")

print("\nTotal unique works:")
print(len(work_data))


print("\nNormal vs Anomaly:")
print(work_data['Is Anomaly'].value_counts())

print("\nAnomaly percentage:")
print(work_data['Is Anomaly'].value_counts(normalize=True) * 100)

print("\nRisk Level:")
print(work_data['Risk Level'].value_counts())


# ============================================================
# 27. TOP ANOMALOUS WORKS
# ============================================================

print("\n========================================")
print("TOP 20 ANOMALOUS WORKS")
print("========================================")


top_anomalies = work_data[
    [
        'Work ID',
        'Work',
        'State',
        'Vendor Name',
        'Sanction Amount ( ₹ )',
        'Amount Disbursed ( ₹ )',
        'Fund Disbursed Amount ( ₹ )',
        'expenditure_ratio',
        'duration_days',
        'payment_count',
        'Is Anomaly',
        'anomaly_score',
        'compliance_score',
        'Risk Level',
        'Anomaly Reason'
    ]
].sort_values('anomaly_score').head(20)

print(top_anomalies.to_string(index=False))

# ============================================================
# 28. HIGH-RISK WORKS
# ============================================================

print("\n========================================")
print("HIGH RISK WORKS")
print("========================================")


high_risk = work_data[work_data['Risk Level'] == 'HIGH'].sort_values('anomaly_score')

print(
    high_risk[
        [
            'Work ID',
            'Work',
            'State',
            'Sanction Amount ( ₹ )',
            'Fund Disbursed Amount ( ₹ )',
            'duration_days',
            'compliance_score',
            'anomaly_score',
            'Anomaly Reason'
        ]
    ].head(10).to_string(index=False)
)


# ============================================================
# 29. ANOMALY REASON COUNTS
# ============================================================

print("\n========================================")
print("RULE VIOLATION COUNTS")
print("========================================")

print("Expenditure > Sanction:",work_data['rule_expenditure_over_sanction'].sum())

print("Disbursement > Sanction:", work_data['rule_disbursement_over_sanction'].sum())

print("Delayed works:",work_data['is_delayed'].sum())

print("High spending + incomplete:",work_data['high_spend_incomplete'].sum())

print("Possible duplicate works:",work_data['possible_duplicate_work'].sum())


OUTPUT_FILE = "MPLADS_Anomaly_Results2.csv"
# work_data.to_csv(OUTPUT_FILE,index=False)


def explain_anomaly(work_row):
    """Passes a row from your MPLADS dataframe to Gemini for an explanation."""
    
    # Construct a prompt using the specific data points from your ML output
    prompt = f"""
    You are an auditor reviewing government MPLADS projects. 
    Explain why the following project was flagged/not flagged by our Isolation Forest ML model.
    Keep it concise, professional, and explain the financial/compliance risk in points.
    
    Project Data:
    - Work Name: {work_row['Work']}
    - Sanctioned Amount: ₹{work_row['Sanction Amount ( ₹ )']}
    - Disbursed Amount: ₹{work_row['Fund Disbursed Amount ( ₹ )']}
    - Duration: {work_row['duration_days']} days
    - Compliance Score: {work_row['compliance_score']}/100
    - Model Anomaly Reasons: {work_row['Anomaly Reason']}
    - Risk Level: {work_row['Risk Level']}
    """
    
    # Generate the explanation using the fast flash model
    response = client.models.generate_content(
        model='gemini-2.5-flash',
        contents=prompt
    )
    
    return response.text

def make_map():

    df = pd.read_csv("MPLADS_Anomaly_Results2.csv")

    # Clean data
    df = df.dropna(subset=['State', 'Risk Level'])

    df['Risk Level'] = (df['Risk Level'].astype(str).str.upper().str.strip())

    # ---------------------------------------------
    # STATEWISE COUNTS
    # ---------------------------------------------

    state_risk = pd.crosstab(df['State'],df['Risk Level']).reset_index()

    # Ensure all columns exist
    for col in ['HIGH', 'MEDIUM', 'LOW']:
        if col not in state_risk.columns:
            state_risk[col] = 0

    state_risk['Total_Works'] = (state_risk['HIGH'] +state_risk['MEDIUM'] +state_risk['LOW'])

    state_risk['High_Risk_%'] = (state_risk['HIGH'] /state_risk['Total_Works'] * 100)

    state_risk['Medium_Risk_%'] = (state_risk['MEDIUM'] /state_risk['Total_Works'] * 100)

    state_risk['Low_Risk_%'] = (state_risk['LOW'] /state_risk['Total_Works'] * 100)


    def get_risk_category(mid_percent):

        if mid_percent >= 50:
            return 3       # HIGH - RED

        elif mid_percent >= 30:
            return 2       # MEDIUM - YELLOW

        else:
            return 1       # LOW - GREEN

    state_risk['Risk_Category'] = (state_risk['Medium_Risk_%'].apply(get_risk_category))

    # ---------------------------------------------
    # STANDARDIZE STATE NAMES
    # ---------------------------------------------

    state_name_mapping = {
        'Andaman And Nicobar Islands':'Andaman & Nicobar Island',
        'Delhi':'NCT of Delhi',
        'Jammu And Kashmir':'Jammu & Kashmir',
        'The Dadra And Nagar Haveli And Daman And Diu':'Dadara & Nagar Havelli',
        'Arunachal Pradesh':'Arunanchal Pradesh'
    }

    state_risk['State'] = (state_risk['State'].replace(state_name_mapping))

    geojson_url = (
        "https://gist.githubusercontent.com/"
        "jbrobst/56c13bbbf9d97d187fea01ca62ea5112/"
        "raw/e388c4cae20aa53cb5090210a42ebb9b765c0a36/"
        "india_states.geojson"
    )

    india_map = gpd.read_file(geojson_url)

    merged = india_map.set_index('ST_NM').join(state_risk.set_index('State'))


    fig, ax = plt.subplots(figsize=(12, 12))

    cmap = ListedColormap([
        '#2ca02c',   # Green
        '#ffdf00',   # Yellow
        '#d62728'    # Red
    ])

    merged['Risk_Category'] = (merged['Risk_Category'].fillna(1))

    merged.plot(column='Risk_Category',cmap=cmap,linewidth=0.8,ax=ax,edgecolor='white')

    ax.axis('off')

    ax.set_title('MPLADS Statewise Risk Analysis',fontsize=20,fontweight='bold')

    # ---------------------------------------------
    # LEGEND
    # ---------------------------------------------

    red_patch = mpatches.Patch(color='#d62728',label='High Risk (≥10%)')

    yellow_patch = mpatches.Patch(color='#ffdf00',label='Medium Risk (5–10%)')

    green_patch = mpatches.Patch(color='#2ca02c',label='Low Risk (<5%)')

    ax.legend(handles=[red_patch,yellow_patch,green_patch],loc='lower right')

    plt.tight_layout()

    output_image = ("Rajya_statewise_Risk_Map.png")

    plt.savefig(output_image,dpi=300,bbox_inches='tight',facecolor='white')
    plt.show()
    plt.close()

    return state_risk


def state_wise_risk():
    state_risk = pd.crosstab(work_data['State'],work_data['Risk Level']).reset_index()
    # Ensure all columns exist
    for col in ['HIGH', 'MEDIUM', 'LOW']:
        if col not in state_risk.columns:
            state_risk[col] = 0

    state_risk['Total_Works'] = (state_risk['HIGH'] +state_risk['MEDIUM'] +state_risk['LOW'])

    state_risk['High_Risk_%'] = (state_risk['HIGH'] /state_risk['Total_Works'] * 100)

    state_risk['Medium_Risk_%'] = (state_risk['MEDIUM'] /state_risk['Total_Works'] * 100)

    state_risk['Low_Risk_%'] = (state_risk['LOW'] /state_risk['Total_Works'] * 100)

    print("\n========================================")
    print("STATEWISE RISK PERCENTAGE")
    print("========================================")

    print(
        state_risk[
            [
                'State',
                'Total_Works',
                'HIGH',
                'MEDIUM',
                'LOW',
                'High_Risk_%',
                'Medium_Risk_%',
                'Low_Risk_%'
            ]
        ].sort_values('High_Risk_%',ascending=False).to_string(index=False)
    )


make_map()
# txt=explain_anomaly(work_data.iloc[827])
# print(txt)