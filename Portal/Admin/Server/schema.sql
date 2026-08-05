-- =========================================================================
-- Kapataksha High School Portal - PostgreSQL Database Setup Script
-- Database Name: StudentData
-- Password: 1910
-- =========================================================================

-- Step 1: Create Database (Run this in pgAdmin or psql console)
-- CREATE DATABASE "StudentData";

-- Connect to "StudentData" database before running the script below:
-- \c StudentData;

-- -------------------------------------------------------------------------
-- Step 2: Create "cards" Table
-- Stores RFID Card UID, Auto-Generated Student ID (26-XXXXX), and Card Name
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cards (
    id SERIAL PRIMARY KEY,
    uid VARCHAR(50) UNIQUE NOT NULL,
    student_id VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- -------------------------------------------------------------------------
-- Step 3: Create "PersonalData" Table
-- Stores detailed Student Personal Information linked to cards table
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS PersonalData (
    id SERIAL PRIMARY KEY,
    student_id VARCHAR(20) UNIQUE NOT NULL REFERENCES cards(student_id) ON DELETE CASCADE,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    gender VARCHAR(10) NOT NULL,
    date_of_birth DATE NOT NULL,
    blood_group VARCHAR(5) NOT NULL,
    religion VARCHAR(30) NOT NULL,
    nationality VARCHAR(50) DEFAULT 'Bangladeshi',
    nid_birth_cert VARCHAR(50),
    photo_url TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- -------------------------------------------------------------------------
-- Step 4: Create Indexes for High-Performance Queries
-- -------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cards_uid ON cards(uid);
CREATE INDEX IF NOT EXISTS idx_cards_student_id ON cards(student_id);
CREATE INDEX IF NOT EXISTS idx_personaldata_student_id ON PersonalData(student_id);

-- -------------------------------------------------------------------------
-- Step 5: Create "StudentAcademicInformation" Table
-- Stores Student Academic Information linked to cards table
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS StudentAcademicInformation (
    id SERIAL PRIMARY KEY,
    student_id VARCHAR(20) UNIQUE NOT NULL REFERENCES cards(student_id) ON DELETE CASCADE,
    admission_number VARCHAR(50),
    admission_date DATE,
    class_name VARCHAR(20),
    roll_number VARCHAR(20),
    registration_number VARCHAR(50),
    section VARCHAR(20),
    student_group VARCHAR(20),
    shift VARCHAR(20),
    session VARCHAR(20),
    academic_year VARCHAR(10),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_academic_student_id ON StudentAcademicInformation(student_id);

-- -------------------------------------------------------------------------
-- Step 6: Create "StudentContactInformation" Table
-- Stores Student Contact Information linked to cards table
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS StudentContactInformation (
    id SERIAL PRIMARY KEY,
    student_id VARCHAR(20) UNIQUE NOT NULL REFERENCES cards(student_id) ON DELETE CASCADE,
    mobile_number VARCHAR(20),
    email_address VARCHAR(100),
    current_address TEXT,
    permanent_address TEXT,
    fathers_name VARCHAR(100),
    fathers_phone VARCHAR(20),
    fathers_occupation VARCHAR(100),
    fathers_email VARCHAR(100),
    mothers_name VARCHAR(100),
    mothers_phone VARCHAR(20),
    mothers_occupation VARCHAR(100),
    mothers_email VARCHAR(100),
    guardian_name VARCHAR(100),
    guardian_relationship VARCHAR(50),
    guardian_phone VARCHAR(20),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contact_student_id ON StudentContactInformation(student_id);
