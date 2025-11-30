import { Router } from "express";
import MetaController from "../controllers/MetaController.js";

// Create a new Express router instance.
const router = Router();

// This route handles the webhook verification request from Meta.
// When setting up a webhook, Meta sends a GET request to this endpoint
// to verify that the server is legitimate.
router.get("/webhook", MetaController.verify);

// This route handles all incoming webhook events from Meta, such as new messages.
// Meta sends a POST request with a JSON payload to this endpoint for every event.
router.post("/webhook", MetaController.handleIncoming);

export default router;
