# Product Requirements Document (PRD)

# Bharat Gas Consumer Location & House Photo Management System

**Project Name:** Bharat Gas Consumer Location System (BGCLS)

**Version:** 2.1 (Enhanced with Offline & Performance Optimizations)

**Organization:** Siddhartha Bharat Gas Agency

---

# 1. Project Overview

## Objective

Develop an internal Progressive Web App (PWA) for delivery agents to collect and maintain accurate GPS locations, house photographs, and delivery notes for existing Bharat Gas consumers. 

The application will feature an **Offline-First** architecture, allowing field agents to seamlessly capture data in areas with poor or no internet connectivity.

The agency already maintains a master database of approximately **30,000 consumers**. The application will enrich these existing records with field-collected location data to help delivery agents locate customer houses quickly and accurately.

---

# 2. Existing Consumer Data

The agency already has the following information for every consumer:

* Consumer Number (Unique)
* Consumer Name
* Mobile Number
* Address

These records will be imported into the application before deployment.

**Consumer Number is the Primary Key** and cannot be changed.

Delivery agents **cannot create new consumers**. They only update location-related information for existing consumers.

---

# 3. Problem Statement

Current challenges include:

* New delivery agents cannot identify customer houses from addresses alone.
* Many addresses are incomplete or lack recognizable landmarks.
* Experienced delivery agents rely on memory rather than documented information.
* Delivery staff spend considerable time searching for houses and calling customers.
* Customer experience suffers due to delayed deliveries.
* **Network Connectivity**: Agents often deliver in areas where mobile network coverage is unreliable, preventing them from uploading data immediately.

---

# 4. Project Goals

The application will:

* Build a verified GPS location database for all consumers.
* Store house photographs for visual identification.
* Allow one-click navigation to customer locations.
* Reduce delivery time and unnecessary customer calls.
* Enable new delivery agents to complete deliveries independently.
* Improve operational efficiency and delivery accuracy.
* **Provide robust offline capabilities** so data collection is never blocked by poor network coverage.

---

# 5. User Roles

## Manager

Permissions:

* View all consumers (paginated for performance)
* Search consumers
* View uploaded locations & Heatmaps/Pin Maps
* View uploaded photos
* Edit incorrect information
* Verify or Reject uploaded locations and photos
* Delete incorrect uploads
* View reports
* View agent performance
* Export reports
* Manage delivery agents

---

## Delivery Agent

Permissions:

* Login using Mobile Number + Password
* Search consumers (with offline support)
* View consumer details
* Capture GPS location (Online/Offline)
* Upload house photographs (Online/Offline)
* Add delivery notes (Online/Offline)
* Navigate using Google Maps
* Update location when customer shifts residence

---

# 6. Authentication

Authentication Provider:

* Supabase Auth

Login Method:

* Mobile Number
* Password

Only registered delivery agents can access the application. (Note: Initial login must happen while online; subsequent sessions should be handled securely by the PWA).

---

# 7. Consumer Search

Primary Search:

* Consumer Number

Optional Search:

* Consumer Name
* Mobile Number

Search results display:

* Consumer Number
* Consumer Name
* Mobile Number
* Address
* Location Status
* Photo Status

*Note: For the 30,000 consumers, search and list views must implement infinite scrolling or pagination.*

---

# 8. Consumer Profile

Every consumer profile displays:

### Existing Information (Read Only)

* Consumer Number
* Consumer Name
* Mobile Number
* Address

### Field Information (Editable by Authorized Users)

* GPS Coordinates
* House Photos
* Delivery Notes
* Uploaded By
* Uploaded Date
* Last Updated
* Verification Status

---

# 9. GPS Collection

Delivery agent taps:

**Save Current Location**

The application captures:

* Latitude
* Longitude
* GPS Accuracy
* Date
* Time
* Delivery Agent

The GPS record is linked to the existing consumer using the Consumer Number. If offline, this data is cached in IndexedDB and uploaded during the next background sync.

---

# 10. House Photos

Required:

* Front House Photo

Optional:

* Gate Photo
* Landmark Photo
* Street Photo
* Building Entrance

Maximum:

* 5 Photos per Consumer

Storage:

* Supabase Storage

Folder Structure:

consumer-photos/
├── ConsumerNumber/
│ ├── front.jpg
│ ├── landmark.jpg
│ ├── gate.jpg
│ └── street.jpg

*(Photos taken offline are stored locally in the browser and queued for upload via Background Sync).*

---

# 11. Delivery Notes

Examples:

* Blue gate
* Opposite temple
* Near water tank
* Call before delivery
* Dog inside
* Second floor
* House behind school

Maximum Length:

500 characters

---

# 12. Location Status & Workflow

Each consumer has one of the following statuses to facilitate a verification workflow:

* Not Collected
* Location Collected (Pending Verification)
* Verified (Approved by Manager)
* Rejected (Requires agent to re-collect)
* Needs Update (e.g., customer shifted)

Managers can filter consumers based on these statuses.

---

# 13. Navigation

When a GPS location exists, delivery agents can tap:

**Navigate**

This opens Google Maps directly to the saved location.

---

# 14. Dashboard

Manager dashboard displays:

* Total Consumers
* Consumers with GPS
* Consumers without GPS
* Consumers with Photos
* Consumers without Photos
* Today's Uploads
* Today's GPS Collections
* Today's Photo Uploads

**Map View Requirement:**
* A Heatmap or Pin Map visualization for managers to visually inspect location collection coverage across different areas.

Progress percentage:

Completed Consumers ÷ Total Consumers × 100

---

# 15. Reports

Reports can be filtered by:

* Delivery Agent
* Date
* Area
* Completion Status
* Photo Status
* GPS Status

Export formats:

* Excel
* CSV
* PDF

---

# 16. Performance Tracking

Each delivery agent has statistics including:

* Total Consumers Updated
* GPS Locations Captured
* Photos Uploaded
* Average Daily Updates
* Last Activity

---

# 17. Database Design

## agents

* id
* name
* mobile
* role
* status
* created_at

## consumers

* id
* consumer_number (Unique)
* consumer_name
* mobile
* address
* verification_status (Pending, Verified, Rejected)
* assigned_agent_id (Nullable - for offline partitioning)
* area_code (Nullable)
* created_at

## consumer_locations

* id
* consumer_id
* latitude
* longitude
* accuracy
* uploaded_by
* uploaded_at

## consumer_photos

* id
* consumer_id
* photo_url
* photo_type
* status (Pending, Approved, Rejected)
* rejection_reason
* uploaded_by
* uploaded_at

## delivery_notes

* id
* consumer_id
* note
* uploaded_by
* created_at

## audit_logs (New)
* id
* action_type (e.g., 'VERIFIED_LOCATION', 'REJECTED_PHOTO')
* entity_id (consumer_id or photo_id)
* performed_by (manager_id or agent_id)
* timestamp

---

# 18. Offline & Performance Architecture

* **Service Workers**: Caching of app shell, UI assets, and Google Maps API scripts to ensure the app loads without internet.
* **IndexedDB**: Local storage mechanism to save consumer search data (partitioned by agent/area if needed) and to queue up location updates, notes, and photos.
* **Background Sync API**: To automatically push cached updates to Supabase as soon as network connectivity is restored.
* **Offline Indicators**: The UI must display the current network status and any pending sync queues to the agent.
* **Pagination/Virtualization**: With 30,000 records, the application UI must implement virtualization or infinite scrolling to prevent memory bloat on mobile devices.

---

# 19. Technology Stack

Frontend

* React
* TypeScript
* Tailwind CSS
* Vite
* Progressive Web App (PWA) with Service Workers & IndexedDB (e.g., via Dexie.js or idb)

Backend

* Supabase PostgreSQL
* Supabase Auth (Email/Password)
* Supabase Storage

Maps

* Browser Geolocation API
* Google Maps Deep Link for Navigation
* Google Maps / Leaflet for Manager Map Dashboard

Deployment

* Vercel (Frontend)
* Supabase (Backend)

---

# 20. Security

* Secure Password Authentication
* Role-Based Access Control
* Supabase Row Level Security (RLS)
* HTTPS
* Audit Logs
* Secure File Storage

---

# 21. Success Criteria

* Import all 30,000 existing consumer records successfully.
* Collect verified GPS coordinates for 100% of consumers.
* Capture at least one front house photo for every consumer.
* Reduce time spent locating customers by at least 70%.
* Allow new delivery agents to complete deliveries without relying on experienced staff.
* **Zero data loss during field operations with unstable network connections.**
