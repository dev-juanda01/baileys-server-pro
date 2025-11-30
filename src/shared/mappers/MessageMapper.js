/**
 * Normalizes a message object from the Meta API format to the Baileys format.
 * This allows for consistent message processing within the application.
 * @param {object} metaMsg - The message object received from the Meta/Whatsapp Cloud API webhook.
 * @returns {object} A message object in the format expected by Baileys.
 */
export const normalizeMetaMessage = (metaMsg) => {
    // Extract common properties from the Meta message object.
    const type = metaMsg.type;
    const from = metaMsg.from;
    const id = metaMsg.id;
    const timestamp = metaMsg.timestamp;
    const pushName = "";

    // Create the base structure of a Baileys message object.
    // This structure is consistent for all message types.
    const baileysMsg = {
        key: {
            remoteJid: `${from}@s.whatsapp.net`, // The sender's JID.
            fromMe: false, // Messages from webhooks are always incoming.
            id: id,
        },
        pushName: pushName,
        messageTimestamp: timestamp,
        message: {},
    };

    // Map the message content based on its type.
    switch (type) {
        case "text":
            baileysMsg.message.conversation = metaMsg.text.body;
            break;
        case "image":
            baileysMsg.message.imageMessage = {
                caption: metaMsg.image.caption, // The caption for the image.
                mimetype: metaMsg.image.mime_type,
                url: null, // Meta does not always provide a direct public URL.
                metaId: metaMsg.image.id, // The media ID from Meta, used to download the file.
            };
            break;
        case "document":
            baileysMsg.message.documentMessage = {
                caption: metaMsg.document.caption,
                fileName: metaMsg.document.filename,
                mimetype: metaMsg.document.mime_type,
                metaId: metaMsg.document.id, // The media ID from Meta.
            };
            break;
        case "audio":
        case "voice":
            // Handle both audio files and voice notes.
            baileysMsg.message.audioMessage = {
                mimetype: metaMsg.voice?.mime_type || metaMsg.audio?.mime_type,
                metaId: metaMsg.voice?.id || metaMsg.audio?.id,
                ptt: type === "voice", // ptt (Push-to-Talk) is true for voice notes.
            };
            break;
        case "video":
            baileysMsg.message.videoMessage = {
                caption: metaMsg.video.caption,
                metaId: metaMsg.video.id, // The media ID from Meta.
            };
            break;
        case "interactive":
            // Handle replies from interactive messages like buttons or lists.
            const interactive = metaMsg.interactive;
            if (interactive.type === "button_reply") {
                // This is a reply from a template with buttons.
                baileysMsg.message.templateButtonReplyMessage = {
                    selectedId: interactive.button_reply.id,
                    selectedDisplayText: interactive.button_reply.title,
                };
            } else if (interactive.type === "list_reply") {
                // This is a reply from a list message.
                baileysMsg.message.listResponseMessage = {
                    singleSelectReply: {
                        selectedRowId: interactive.list_reply.id,
                    },
                    title: interactive.list_reply.title,
                };
            }
            break;
    }

    // Return the fully constructed Baileys message object.
    return baileysMsg;
};
