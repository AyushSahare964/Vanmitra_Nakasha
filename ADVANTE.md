Build a complete, modern, responsive, professional web application called:

# ADVANTE

Full Name:

**Automated Integration and Intelligent Harmonization of Multi-source Geospatial Data for Urban Land Record Management**

The application is an AI-powered Web GIS platform designed for government land administration, GIS surveyors, municipal authorities, and land record officers.

The main purpose of the system is to integrate and harmonize multiple geospatial and land record data sources such as cadastral maps, drone imagery, satellite imagery, GNSS survey points, GeoJSON, shapefiles, and textual land records into a unified intelligent land management platform.

---

# IMPORTANT PRODUCT REQUIREMENT

This should NOT look like a generic dashboard.

The product should look like a professional:

- Government technology platform
- Enterprise GIS application
- AI-powered geospatial intelligence system
- Smart city land administration platform

The UI should be modern, clean, highly professional, map-focused, and data-driven.

Use a premium enterprise SaaS design with:

- Clean typography
- Spacious layout
- Professional cards
- Subtle shadows
- Minimal gradients
- Responsive design
- Modern icons
- Interactive data visualization
- GIS-style controls

Use a sophisticated visual hierarchy.

---

# TECHNOLOGY

Build the frontend using:

- React
- TypeScript
- Tailwind CSS
- shadcn/ui components

Use reusable components and maintain a scalable folder structure.

For the map interface, create a MapLibre or Leaflet-ready architecture.

For now, use realistic mock GeoJSON and mock parcel data where backend data is unavailable.

Do not build a simple static website.

Build a functional application prototype with:

- Navigation
- Working buttons
- Modals
- Forms
- Tables
- Filters
- Search
- Interactive map layers
- Parcel selection
- Status changes
- Review workflows

---

# APPLICATION NAME AND BRANDING

Application Name:

**ADVANTE**

Tagline:

**Intelligent Geospatial Harmonization for Urban Land Records**

Full Product Description:

ADVANTE is an AI-powered platform that automatically integrates and harmonizes multi-source geospatial datasets and urban land records. It detects parcel boundaries, aligns different coordinate systems, compares datasets, identifies conflicts, calculates confidence scores, and creates verified Golden Land Records.

---

# MAIN APPLICATION LAYOUT

Create a desktop-first enterprise application layout.

Use:

## Top Navigation Bar

Include:

- ADVANTE logo
- Global search
- Location / Project selector
- Notifications
- Help
- User profile menu

---

## Left Sidebar Navigation

Create the following navigation items:

Dashboard

Map Explorer

Datasets

Processing Center

Review Queue

Conflicts

Golden Records

Reports

AI Assistant

Settings

Use appropriate professional icons.

The sidebar should support collapse and expand.

---

# PAGE 1 — DASHBOARD

Create a professional executive dashboard.

At the top, display:

# Good Morning, User

Subtitle:

Monitor and manage urban land record harmonization activities.

Create KPI cards:

1. Total Land Parcels
2. Total Datasets
3. Harmonized Records
4. Pending Review
5. Active Conflicts
6. Verified Golden Records

Each card should show:

- Main number
- Trend
- Small icon
- Percentage change

---

## Dashboard Visualizations

Create charts for:

### Harmonization Status

Show:

- Verified
- Under Review
- Conflicted
- Field Verification

### Confidence Score Distribution

Show parcels grouped by:

- Above 90%
- 75% to 90%
- Below 75%

### Dataset Sources

Display:

- Drone
- Cadastral
- GNSS
- Satellite
- Revenue Records
- Municipal Records

### Recent Processing Activity

Display a timeline such as:

Dataset uploaded

AI processing completed

Conflict detected

Officer reviewed parcel

Golden Record created

---

# PAGE 2 — MAP EXPLORER

This should be one of the most advanced and visually impressive pages.

Create a full-screen GIS map interface.

Layout:

LEFT PANEL:

Layer Management

CENTER:

Interactive Map

RIGHT PANEL:

Parcel Information

---

## Map Layers

Create toggle switches for:

- Satellite Imagery
- Drone Orthomosaic
- Cadastral Boundaries
- Golden Records
- GNSS Points
- Revenue Records
- Conflict Zones

---

## Parcel Status Colors

Use visually clear status indicators:

Verified

Needs Review

Conflict

New Harmonized Record

Incomplete Data

---

## Parcel Interaction

When a user clicks a parcel:

Open a professional side panel showing:

Survey Number

Parcel ID

Area

Confidence Score

Data Sources

Owner Record

Last Updated

Conflict Status

Verification Status

Show buttons:

View Details

Compare Sources

Send for Review

Create Golden Record

---

# PAGE 3 — DATASET MANAGEMENT

Create a professional dataset library.

Include:

Search

Filter by dataset type

Filter by location

Filter by processing status

Filter by date

---

## Dataset Table

Columns:

Dataset Name

Type

Source

Location

Coordinate System

Quality Score

Status

Upload Date

Actions

---

## Upload Dataset

Create a multi-step upload wizard.

Step 1:

Select Data Source

Options:

Cadastral Map

Drone Imagery

Satellite Imagery

GNSS Data

GeoJSON

Shapefile

Revenue Record

Municipal Record

---

Step 2:

Upload File

Create drag-and-drop file upload.

Show:

File name

File size

Format

Upload progress

---

Step 3:

Dataset Metadata

Fields:

Dataset Name

Source Department

Village

Ward

Taluka

District

Survey Date

Coordinate System

Data Accuracy

---

Step 4:

Review and Start Processing

Show dataset summary.

Button:

Start AI Processing

---

# PAGE 4 — PROCESSING CENTER

Create a visual pipeline showing:

Dataset Quality Analysis

↓

Coordinate Harmonization

↓

Georeferencing

↓

Parcel Boundary Detection

↓

Spatial Matching

↓

Record Fusion

↓

Conflict Detection

↓

Confidence Scoring

↓

Golden Record Creation

Show real-time processing progress.

Each stage should have:

Pending

Processing

Completed

Failed

states.

Create a processing detail panel.

---

# PAGE 5 — REVIEW QUEUE

Create a queue for records requiring human verification.

Show a table containing:

Survey Number

Location

Confidence

Conflict Type

Data Sources

Priority

Status

---

When the user opens a review:

Create a split-screen interface.

LEFT:

Original cadastral or source data.

CENTER:

Interactive map with parcel geometry.

RIGHT:

AI analysis.

Display:

Boundary Match Score

Record Match Score

GNSS Alignment

Datum Accuracy

Final Confidence

AI Recommendation

---

Create action buttons:

Approve

Reject

Request Correction

Send for Field Verification

---

# PAGE 6 — CONFLICT DETECTION

Create a dedicated conflict management page.

Conflict types:

Boundary Overlap

Area Mismatch

Ownership Conflict

Survey Number Mismatch

Coordinate System Error

Duplicate Record

---

Display:

Conflict Severity

Low

Medium

High

Critical

---

Create a map visualization where conflict areas can be highlighted.

---

# PAGE 7 — GOLDEN LAND RECORDS

Create a professional land record database interface.

Display:

Golden Record ID

Survey Number

Location

Area

Owner

Confidence

Version

Status

---

Create detailed Golden Record view.

Include:

Overview

Spatial Information

Source Records

AI Analysis

Version History

Audit Trail

---

Include a visual source fusion diagram:

Drone Data

+

Cadastral Map

+

GNSS

+

Revenue Record

↓

Golden Land Record

---

# PAGE 8 — AI ASSISTANT

Create an AI-powered Natural Language GIS Assistant.

Title:

# Ask Advante AI

Subtitle:

Query your land records using natural language.

Create a chat interface.

Support:

English

Hindi

Marathi

Example queries:

"Show all disputed parcels."

"Show parcels with confidence below 75%."

"सर्व्हे नंबर 255 ची माहिती दाखवा."

"किती parcels human review मध्ये आहेत?"

"Show overlapping parcels in this area."

When the AI returns an answer:

Show:

Natural language answer

Relevant parcels

Confidence

Map highlight action

Suggested follow-up questions

---

# PAGE 9 — REPORTS

Create a reports page.

Report cards:

Parcel Verification Report

Conflict Report

Dataset Quality Report

Harmonization Report

Confidence Analysis

Golden Record Report

Buttons:

Generate Report

Download PDF

Export CSV

Export GeoJSON

---

# PAGE 10 — SETTINGS

Include:

Profile

Organization

User Management

Roles and Permissions

Coordinate System Settings

AI Model Settings

Notification Settings

API Settings

---

# CONFIDENCE SCORING COMPONENT

Create a reusable Confidence Score component.

The score is calculated conceptually using:

Boundary Quality — 30%

Record Match Score — 35%

GNSS Alignment — 25%

Datum Accuracy — 10%

Display this visually using:

- Circular confidence indicator
- Horizontal bars
- Score breakdown

---

# DECISION ROUTING

Display record routing clearly:

Confidence >= 90%

AUTO HARMONIZED

Confidence between 75% and 89%

HUMAN REVIEW REQUIRED

Confidence below 75%

FIELD VERIFICATION REQUIRED

This routing should be visually prominent.

---

# MOCK DATA

Generate realistic Indian urban land management mock data.

Use examples such as:

Survey Number: 255/1

Ward: Ward 12

District: Pune

Area: 1,250 sqm

Coordinate System: WGS84

Dataset sources:

Drone Survey

Cadastral Map

GNSS

Revenue Record

Create approximately:

30 to 50 mock parcels

Multiple confidence scores

Multiple conflict types

Multiple dataset records

Multiple processing tasks

---

# DESIGN SYSTEM

Use a professional enterprise design.

Prioritize:

- High readability
- Strong data hierarchy
- Clean spacing
- Modern typography
- Professional government technology feel
- GIS-focused UI
- Desktop productivity

Avoid:

- Excessive gradients
- Gaming-style design
- Overly colorful UI
- Generic startup landing page style
- Large unnecessary illustrations

The interface should feel similar to a professional GIS intelligence and land administration platform.

---

# RESPONSIVE DESIGN

The application must work on:

Desktop

Laptop

Tablet

Mobile

However, optimize the complex GIS and review interfaces primarily for desktop and laptop.

---

# IMPORTANT FUNCTIONAL REQUIREMENTS

Make the following interactions functional using frontend state and realistic mock data:

1. Upload datasets
2. Filter datasets
3. Search survey numbers
4. Toggle map layers
5. Select parcels
6. View parcel details
7. Compare datasets
8. Change parcel review status
9. Approve or reject records
10. Create Golden Records
11. Filter conflicts
12. Ask questions to the AI Assistant using simulated responses
13. Navigate between all pages
14. Show processing progress
15. Display realistic status changes

---

# FINAL RESULT

Build a complete working frontend prototype for ADVANTE.

The product should communicate:

AI + GIS + Land Administration + Multi-source Data Harmonization + Intelligent Decision Support.

Do not create only a landing page.

Start by creating the complete authenticated application shell with:

- Sidebar
- Top navigation
- Dashboard
- Routing
- Map Explorer
- Dataset Management

Then build the remaining modules using reusable components and realistic mock data.