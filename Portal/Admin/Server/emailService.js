const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const transporter = nodemailer.createTransport({
    service: 'gmail', // Use 'gmail' or configure SMTP manually
    auth: {
        user: process.env.SMTP_EMAIL,
        pass: process.env.SMTP_PASSWORD
    }
});

const getEmailTemplate = (studentDetails, checkType, timeStr, dateStr) => {
    const isCheckIn = checkType === 'IN';
    
    const headerBg = isCheckIn ? '#1c5b7d' : '#876911'; // Blue vs Gold/Brown
    const titleText = isCheckIn ? 'Attendance — Check IN' : 'Attendance — Check OUT';
    
    const actionText = isCheckIn 
        ? 'Your child has <strong>arrived</strong> at school and successfully checked in.' 
        : 'Your child has <strong>left</strong> school and checked out.';
    
    const boxBg = isCheckIn ? '#e8f5e9' : '#fff8e1';
    const boxColor = isCheckIn ? '#2e7d32' : '#c49000';
    const boxIcon = isCheckIn ? '✅' : '🏫';
    const boxText = isCheckIn ? 'Checked IN' : 'Checked OUT';
    const timeColor = isCheckIn ? '#2e7d32' : '#f57c00'; // Green vs Orange
    
    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; color: #333;">
        <!-- Header -->
        <div style="background-color: ${headerBg}; padding: 20px; color: white;">
            <h2 style="margin: 0; font-size: 20px; font-weight: normal;">
                📋 <strong>${titleText}</strong>
            </h2>
            <p style="margin: 5px 0 0 0; font-size: 13px; color: #e0e0e0;">
                SKR Electronics Lab — RFID Attendance System
            </p>
        </div>

        <!-- Body -->
        <div style="padding: 25px;">
            <p style="font-size: 16px; margin-top: 0;">Dear Parent / Guardian,</p>
            <p style="font-size: 15px; color: #555;">${actionText}</p>

            <!-- Status Box -->
            <div style="background-color: ${boxBg}; border-left: 5px solid ${boxColor}; padding: 15px; margin: 25px 0; border-radius: 4px;">
                <h3 style="margin: 0; color: ${boxColor}; font-size: 22px;">
                    ${boxIcon} ${boxText}
                </h3>
            </div>

            <!-- Details Table -->
            <table style="width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 14px;">
                <tr>
                    <td style="padding: 10px 0; color: #777; width: 120px;">Student</td>
                    <td style="padding: 10px 0; font-weight: bold; color: #333;">${studentDetails.name}</td>
                </tr>
                <tr>
                    <td style="padding: 10px 0; color: #777;">Roll</td>
                    <td style="padding: 10px 0; color: #333;">${studentDetails.roll_number || 'N/A'}</td>
                </tr>
                <tr>
                    <td style="padding: 10px 0; color: #777;">Class / Section</td>
                    <td style="padding: 10px 0; color: #333;">${studentDetails.class_name || 'N/A'} — ${studentDetails.section || 'N/A'}</td>
                </tr>
                <tr>
                    <td style="padding: 10px 0; color: #777;">Date</td>
                    <td style="padding: 10px 0; color: #333;">${dateStr}</td>
                </tr>
                <tr>
                    <td style="padding: 10px 0; color: #777;">Check-${isCheckIn ? 'in' : 'out'} Time</td>
                    <td style="padding: 10px 0; font-weight: bold; color: ${timeColor};">${timeStr}</td>
                </tr>
            </table>
        </div>

        <!-- Footer -->
        <div style="background-color: #f5f5f5; padding: 15px; text-align: center; font-size: 12px; color: #999;">
            This is an automated message. Please do not reply.
        </div>
    </div>
    `;
};

const sendAttendanceEmail = async (studentDetails, checkType) => {
    try {
        if (!process.env.SMTP_EMAIL || !process.env.SMTP_PASSWORD) {
            console.warn('SMTP configuration is missing. Skipping email.');
            return;
        }

        const parentsEmails = [];
        if (studentDetails.fathers_email) parentsEmails.push(studentDetails.fathers_email);
        if (studentDetails.mothers_email) parentsEmails.push(studentDetails.mothers_email);

        if (parentsEmails.length === 0) {
            console.log(`No parent emails found for student: ${studentDetails.name}`);
            return;
        }

        const dateObj = new Date();
        const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Dhaka' };
        const timeOptions = { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dhaka' };
        
        const dateStr = dateObj.toLocaleDateString('en-US', dateOptions);
        const timeStr = dateObj.toLocaleTimeString('en-US', timeOptions);

        const htmlContent = getEmailTemplate(studentDetails, checkType, timeStr, dateStr);

        const mailOptions = {
            from: `"SKR Electronics Lab" <${process.env.SMTP_EMAIL}>`,
            to: parentsEmails.join(','),
            subject: `Attendance Check ${checkType}: ${studentDetails.name}`,
            html: htmlContent
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`Email sent successfully for ${studentDetails.name} (Check ${checkType}): %s`, info.messageId);
    } catch (error) {
        console.error('Error sending email:', error.message);
    }
};

const getLateEmailTemplate = (studentDetails, dateStr, timeInStr, thresholdStr) => {
    const headerBg = '#d32f2f'; // Red/Warning color
    const titleText = 'Attendance - LATE ARRIVAL';
    
    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; color: #333;">
        <div style="background-color: ${headerBg}; padding: 20px; color: white;">
            <h2 style="margin: 0; font-size: 20px; font-weight: normal;">
                &#9888; <strong>${titleText}</strong>
            </h2>
            <p style="margin: 5px 0 0 0; font-size: 13px; color: #ffebee;">
                SKR Electronics Lab - RFID Attendance System
            </p>
        </div>

        <div style="padding: 25px;">
            <p style="font-size: 16px; margin-top: 0;">Dear Parent / Guardian,</p>
            <p style="font-size: 15px; color: #555;">This is to inform you that your child has <strong>arrived late</strong> to school today.</p>

            <div style="background-color: #ffebee; border-left: 5px solid #d32f2f; padding: 15px; margin: 25px 0; border-radius: 4px;">
                <h3 style="margin: 0; color: #d32f2f; font-size: 20px;">
                    &#9200; Arrived Late
                </h3>
            </div>

            <table style="width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 14px;">
                <tr>
                    <td style="padding: 10px 0; color: #777; width: 150px;">Student</td>
                    <td style="padding: 10px 0; font-weight: bold; color: #333;">${studentDetails.name}</td>
                </tr>
                <tr>
                    <td style="padding: 10px 0; color: #777;">Roll</td>
                    <td style="padding: 10px 0; color: #333;">${studentDetails.roll_number || 'N/A'}</td>
                </tr>
                <tr>
                    <td style="padding: 10px 0; color: #777;">Class / Section</td>
                    <td style="padding: 10px 0; color: #333;">${studentDetails.class_name || 'N/A'} - ${studentDetails.section || 'N/A'}</td>
                </tr>
                <tr>
                    <td style="padding: 10px 0; color: #777;">Date</td>
                    <td style="padding: 10px 0; color: #333;">${dateStr}</td>
                </tr>
                <tr>
                    <td style="padding: 10px 0; color: #777;">Expected Time</td>
                    <td style="padding: 10px 0; color: #333;">Before ${thresholdStr}</td>
                </tr>
                <tr>
                    <td style="padding: 10px 0; color: #777;">Actual Arrival Time</td>
                    <td style="padding: 10px 0; font-weight: bold; color: #d32f2f;">${timeInStr}</td>
                </tr>
            </table>
        </div>

        <div style="background-color: #f5f5f5; padding: 15px; text-align: center; font-size: 12px; color: #999;">
            This is an automated message. Please do not reply.
        </div>
    </div>
    `;
};

const sendLateEmail = async (studentDetails, dateStr, timeInStr, thresholdStr) => {
    try {
        if (!process.env.SMTP_EMAIL || !process.env.SMTP_PASSWORD) {
            console.warn('SMTP configuration is missing. Skipping email.');
            return;
        }

        const parentsEmails = [];
        if (studentDetails.fathers_email) parentsEmails.push(studentDetails.fathers_email);
        if (studentDetails.mothers_email) parentsEmails.push(studentDetails.mothers_email);

        if (parentsEmails.length === 0) {
            console.log(`No parent emails found for student: ${studentDetails.name}`);
            return;
        }

        const htmlContent = getLateEmailTemplate(studentDetails, dateStr, timeInStr, thresholdStr);

        const mailOptions = {
            from: `"SKR Electronics Lab" <${process.env.SMTP_EMAIL}>`,
            to: parentsEmails.join(','),
            subject: `Late Arrival Notice: ${studentDetails.name}`,
            html: htmlContent
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`Late arrival email sent successfully for ${studentDetails.name}: %s`, info.messageId);
    } catch (error) {
        console.error('Error sending late email:', error.message);
    }
};

const getBunkEmailTemplate = (studentDetails, dateStr, timeInStr) => {
    const headerBg = '#d84315'; // Dark Orange/Red
    const titleText = 'Attendance - UNEXPECTED ABSENCE';
    
    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; color: #333;">
        <div style="background-color: ${headerBg}; padding: 20px; color: white;">
            <h2 style="margin: 0; font-size: 20px; font-weight: normal;">
                &#9888; <strong>${titleText}</strong>
            </h2>
            <p style="margin: 5px 0 0 0; font-size: 13px; color: #ffebee;">
                SKR Electronics Lab - RFID Attendance System
            </p>
        </div>

        <div style="padding: 25px;">
            <p style="font-size: 16px; margin-top: 0;">Dear Parent / Guardian,</p>
            <p style="font-size: 15px; color: #555;">This is an urgent notification to inform you that your child <strong>checked IN</strong> to school today but has <strong>NOT checked OUT</strong> by the end of the day.</p>

            <div style="background-color: #fbe9e7; border-left: 5px solid #d84315; padding: 15px; margin: 25px 0; border-radius: 4px;">
                <h3 style="margin: 0; color: #d84315; font-size: 20px;">
                    &#10071; Check-Out Missing
                </h3>
            </div>

            <table style="width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 14px;">
                <tr>
                    <td style="padding: 10px 0; color: #777; width: 150px;">Student</td>
                    <td style="padding: 10px 0; font-weight: bold; color: #333;">${studentDetails.name}</td>
                </tr>
                <tr>
                    <td style="padding: 10px 0; color: #777;">Roll</td>
                    <td style="padding: 10px 0; color: #333;">${studentDetails.roll_number || 'N/A'}</td>
                </tr>
                <tr>
                    <td style="padding: 10px 0; color: #777;">Class / Section</td>
                    <td style="padding: 10px 0; color: #333;">${studentDetails.class_name || 'N/A'} - ${studentDetails.section || 'N/A'}</td>
                </tr>
                <tr>
                    <td style="padding: 10px 0; color: #777;">Date</td>
                    <td style="padding: 10px 0; color: #333;">${dateStr}</td>
                </tr>
                <tr>
                    <td style="padding: 10px 0; color: #777;">Check-In Time</td>
                    <td style="padding: 10px 0; font-weight: bold; color: #2e7d32;">${timeInStr}</td>
                </tr>
                <tr>
                    <td style="padding: 10px 0; color: #777;">Check-Out Time</td>
                    <td style="padding: 10px 0; font-weight: bold; color: #d32f2f;">Missing / Did Not Scan</td>
                </tr>
            </table>
        </div>

        <div style="background-color: #f5f5f5; padding: 15px; text-align: center; font-size: 12px; color: #999;">
            This is an automated message. Please do not reply.
        </div>
    </div>
    `;
};

const sendBunkEmail = async (studentDetails, dateStr, timeInStr) => {
    try {
        if (!process.env.SMTP_EMAIL || !process.env.SMTP_PASSWORD) {
            console.warn('SMTP configuration is missing. Skipping email.');
            return;
        }

        const parentsEmails = [];
        if (studentDetails.fathers_email) parentsEmails.push(studentDetails.fathers_email);
        if (studentDetails.mothers_email) parentsEmails.push(studentDetails.mothers_email);

        if (parentsEmails.length === 0) {
            console.log(`No parent emails found for student: ${studentDetails.name}`);
            return;
        }

        const htmlContent = getBunkEmailTemplate(studentDetails, dateStr, timeInStr);

        const mailOptions = {
            from: `"SKR Electronics Lab" <${process.env.SMTP_EMAIL}>`,
            to: parentsEmails.join(','),
            subject: `URGENT: Missing Check-Out for ${studentDetails.name}`,
            html: htmlContent
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`Bunk report email sent successfully for ${studentDetails.name}: %s`, info.messageId);
    } catch (error) {
        console.error('Error sending bunk email:', error.message);
    }
};

module.exports = { sendAttendanceEmail, sendLateEmail, sendBunkEmail };
