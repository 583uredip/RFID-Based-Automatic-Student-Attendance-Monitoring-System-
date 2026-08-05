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
