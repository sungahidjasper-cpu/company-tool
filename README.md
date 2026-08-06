# 🏢 Company Management Platform

A modern full-stack Company Management Platform built with **Next.js**, **TypeScript**, **Prisma**, and **PostgreSQL**.

The platform is designed for organizations that need centralized management of companies, employees, clients, projects, tasks, files, and role-based permissions.

---

# 🚀 Features

## Company Management
- Create companies
- Edit company information
- Archive & restore companies
- Company dashboard

## User Management
- Employee accounts
- User profiles
- Role management
- Active/Archived users

## Client Management
- Client CRUD
- Client profile
- Company association
- Contact information

## Project Management
- Create projects
- Project status
- Client association
- Project dashboard

## Task Management
- Task CRUD
- Task Status
- Priority
- Due Dates
- Task Assignment
- Subtasks
- Comments
- Activity Timeline

## File Management
Supports uploads for:

- Companies
- Users
- Clients
- Projects
- Tasks

Features include:

- Upload
- Preview
- Download
- Delete
- File ownership validation
- Permission-based access

---

# 🔐 Role-Based Access Control (RBAC)

Current roles include:

| Role | Permissions |
|------|-------------|
| Super Admin | Full system access |
| Admin | Company management |
| Manager | Team & Project management |
| Employee | Assigned work only |

Permissions are enforced both on the frontend and backend.

---

# 🛠 Tech Stack

### Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui

### Backend

- Next.js API Routes
- Prisma ORM
- PostgreSQL

### Authentication

- NextAuth

### Storage

- Local File Storage
- Prisma File Metadata

---

# 📂 Project Structure

```
app/
components/
features/
hooks/
lib/
prisma/
public/
storage/
store/
types/
```

---

# 📦 Installation

Clone the repository

```bash
git clone https://github.com/sungahidjasper-cpu/company-tool.git
```

Go to the project

```bash
cd company-tool
```

Install dependencies

```bash
npm install
```

Configure environment variables

```bash
cp .env.example .env
```

Run Prisma

```bash
npx prisma generate
npx prisma migrate dev
```

Start development server

```bash
npm run dev
```

---

# 🔧 Environment Variables

Example:

```env
DATABASE_URL=
NEXTAUTH_SECRET=
NEXTAUTH_URL=
```

---

# 🗄 Database

Database is managed using **Prisma ORM**.

Main entities include:

- Company
- User
- Client
- Project
- Task
- Comment
- Activity
- File

---

# 🧪 Testing

Completed testing includes:

- CRUD Operations
- RBAC Validation
- File Upload
- File Preview
- File Download
- File Delete
- Ownership Validation
- Permission Validation
- End-to-End Smoke Testing

---

# 📸 Screenshots

Screenshots will be added as development progresses.

- Dashboard
- Company Management
- Project Management
- Task Board
- File Upload
- User Management

---

# 🗺 Development Progress

## ✅ Phase 1

- Authentication
- Initial Project Setup

## ✅ Phase 2

- Company
- Users
- Clients

## ✅ Phase 3

- Projects

## ✅ Phase 4

- Tasks
- Comments
- Activity Timeline

## ✅ Phase 5

- File Management
- RBAC
- Upload System
- Preview
- Download
- Delete

## 🚧 Phase 6

Planned features:

- Dashboard Analytics
- Notifications
- Email Integration
- Advanced Reporting
- Search Improvements
- Production Deployment

---

# 🔒 Security

Implemented security features include:

- Authentication
- Authorization
- RBAC
- Ownership Validation
- Route Protection
- Server-side Permission Checks

---

# 📈 Future Improvements

- AWS S3 Storage
- Email Notifications
- Audit Logs
- API Documentation
- Docker Support
- CI/CD Pipeline
- Unit Testing
- Integration Testing
- Dark Mode Improvements

---

# 👨‍💻 Author

**Jasper Sungahid**

GitHub:
https://github.com/sungahidjasper-cpu

Portfolio:
https://sungahidportfolio.my.canva.site/

---

# 📄 License

This project is for educational and portfolio purposes.
