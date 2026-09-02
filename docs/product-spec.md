# Product Specification: Internal Operations Service Hub

## 1. Problem / Context
Employees right now ask for HR papers (like proof of work or pay letters, or even just asking for clarification in a certain topic) through random ways like emails and chat messages. This causes long waits, lost requests, and a total lack of history tracking. The goal is to build one main company website to make these requests the same for everyone and keep track of them.

## 2. Known Facts
* Employees request things like documents or ask for help in a specific subject.
* HR finishing these requests is currently done by hand and not tracked.
* Employees often need basic official papers, so they request them from the HR.
* HR must review and approve these requests, and manually provide the documents.

## 3. Actors / Stakeholders
* **Employee:** Starts requests, tracks progress, and downloads final documents.
* **HR Administrator:** Looks over the list of requests, changes their status, and uploads the finished files.
both are actor and stakeholder at the same time.

## 4. Requirements
### Functional Requirements
* **Catalog:** Employees can view a standard list of requestable HR documents.
* **Submission:** Employees can submit a request with optional context/notes, and must select a Priority Level (e.g., Low, Standard, Urgent).
* **Tracking:** Employees can view the real-time status of their own requests.
* **Queue Management:** HR Administrators have a centralized dashboard to view all incoming requests, which defaults to sorting by Priority Level so Urgent requests surface immediately.
* **Cancellation**: employee must be able to cancel a request if its state is strictly "pending".
* **State Management:** HR Administrators can update request statuses (e.g., *Pending*, *In Progress*, *Completed*, *Rejected*) and *Canceled* for employees.
* **Fulfillment:** HR Administrators can upload the final document to a completed request, making it available for the employee to download, or another way to mark the request as "complete" is by simply writing a resolution note or an answer to a question from the employee(like clarification in a certain topic or if they're asking for help).
* **Document Management:** HR Administrators can delete an uploaded document from a completed request (e.g., if the wrong file was uploaded), which securely purges the file and allows a replacement upload.
* **Notifications:** The system integrates with Firebase Cloud Messaging to send real-time push notifications to employees and HR Administrators when a request status changes (e.g., Completed, Cancelled), ensuring they are alerted even if the application is closed.

### Non-Functional Requirements
* **Security & RBAC:** Strict Role-Based Access Control ensuring standard users cannot access HR administrative functions.
* **Data Isolation:** The backend logic must strictly isolate records; an API token must only be able to query the user's own historical data.
* **Auditability:** The system architecture must include an unchangeable audit log for every state transition of a request (who changed what, and when). e.g if the hr approves the request then denies it later, the history log still shows both actions in the database, like this:
{ request_id: 105, old_state: "PENDING", new_state: "COMPLETED", updated_by: "hr_admin_42", timestamp: "2026-08-25T14:30:00Z" }
* **Rate limits**: the api must include strict rate limiting, for example 5 requests per minute, to prevent overwhelming the database.
* **Data Retention:** To optimize storage costs and minimize security risks, the system must enforce an automated 30-day retention policy, permanently purging any document payloads in the storage bucket 30 days after fulfillment.

## 5. Assumptions, Constraints, & Unknowns
* **Assumptions:** The system will use the company's existing identity provider / Single Sign-On (SSO) for authentication. The system operates entirely within the corporate intranet or behind a corporate VPN, meaning traffic is restricted to internal employees and authenticated HR personnel.
* **Constraints:** Document payloads must reside exclusively in a private object storage bucket with public internet access completely disabled. Direct client-to-storage access is strictly prohibited; all file retrieval must be brokered and authorized dynamically through the backend API.
* **Unknowns:** What are the strict Service Level Agreements (SLAs) for HR turnaround times? (time the HR is allowed to take to finish a request).

## 6. Non-Goals
* **NO** automated document generation (HR will manually create and upload the PDFs for now).
* **NO** paycheck handling, tracking money spent, or managing vacation days.
* **NO** complex frontend UI animations; focus is strictly on data flow and state management. 
* **NO** Live chat; The app will not include a real-time messaging system between HR and employees (communications are limited strictly to optional request notes).

## 7. Acceptance Criteria
* **Correct Behavior (Submission):** When an employee submits a request, it immediately appears in the HR Admin queue marked as "Pending".
* **Correct Behavior (Fulfillment):** When an HR Admin attaches a file and updates the status to "Completed", the initiating employee can successfully download the file.
* **Correct Behavior (Security):** If an employee attempts to query a request ID belonging to a different user, the backend strictly returns a 403 Forbidden error.
* **Correct Behavior (Upload Limits)**: If an HR Admin attempts to upload an unsupported file type (like an .mp4 video), the system blocks the upload and returns an error.
* **Correct Behavior (Cancellation)**: Given a request has a status of PENDING, When the initiating employee clicks "Cancel", Then the backend updates the state to CANCELLED and returns HTTP 200 OK.
* **Correct Behavior (State Machine Enforcement):** Given a request has a status of IN_PROGRESS or COMPLETED, When the initiating employee attempts to cancel it, Then the backend rejects the action and returns an HTTP 400 Bad Request.
* **Correct Behavior (Concurrency):** Given a PENDING request, When two HR Administrators attempt to claim the request at the exact same millisecond, Then the database locks the row, processing the first request and returning an HTTP 409 Conflict to the second administrator.
* **Correct Behavior (Resolution Validation):** When an HR Administrator attempts to mark a request as COMPLETED, but the payload contains neither an attached file nor a resolution note, Then the API blocks the state transition and returns an HTTP 400 Bad Request.
* **Correct Behavior (Storage Mismatch):** Given a request marked COMPLETED, When an employee attempts to download a file that was permanently deleted from the external storage bucket, Then the API handles the error and returns a 404 Not Found.
* **Correct Behavior (Priority Routing):** Given multiple PENDING requests, When the HR Administrator opens their dashboard, Then the API returns the list sorted by Priority (Urgent first, then Standard, then Low) so critical issues are handled immediately.
* **Correct Behavior (Data Lifecycle):** Given a document payload has existed in the external storage bucket for exactly 30 days, Then the storage system automatically and permanently deletes the file without requiring human intervention.
* **Correct Behavior (Document Deletion):** When an HR Admin deletes an uploaded document, Then the system permanently shreds the file from the private storage bucket, clears the file reference text in the database, and records the deletion in the audit log.