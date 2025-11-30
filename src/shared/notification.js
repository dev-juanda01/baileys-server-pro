import nodemailer from 'nodemailer';
import logger from './logger.js';

let transporter;

// Solo configuramos el transporter si las variables de entorno existen
if (process.env.SMTP_USER && process.env.EMAIL_NOTIFY_TO) {
    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465, // true para 465, false para otros
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });

    logger.info('Servicio de notificación por email inicializado.');
}

/**
 * Envía un correo electrónico de alerta si el SMTP está configurado.
 * @param {string} subject - El asunto del correo.
 * @param {string} body - El cuerpo del correo (HTML).
 */
export const sendEmailAlert = async (subject, body) => {
    if (!transporter) {
        logger.warn('Se solicitó una alerta por email, pero el SMTP no está configurado. Omitiendo.');
        return;
    }

    try {
        await transporter.sendMail({
            from: `"Baileys Server Pro" <${process.env.SMTP_USER}>`,
            to: process.env.EMAIL_NOTIFY_TO,
            subject: `[ALERTA] Baileys Server: ${subject}`,
            html: `<div style="font-family: Arial, sans-serif; font-size: 14px;">
                     <h2>Alerta Crítica del Servidor Baileys</h2>
                     ${body}
                   </div>`,
        });
        logger.info(`Alerta por email enviada exitosamente a ${process.env.EMAIL_NOTIFY_TO}`);
    } catch (error) {
        logger.error({ error }, 'Error CRÍTICO: No se pudo enviar la alerta por email.');
    }
};