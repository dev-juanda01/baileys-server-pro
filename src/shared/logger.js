import pino from "pino";

// This configures a "transport" for Pino, which is a mechanism to process and format log messages.
// Here, we are using 'pino-pretty' to make the console output more human-readable during development.
const transport = pino.transport({
    // The target specifies the module responsible for formatting the logs.
    target: "pino-pretty",
    // These are the options passed to the 'pino-pretty' target.
    options: {
        colorize: true, // Adds colors to the log output (e.g., red for errors, yellow for warnings).
        translateTime: "SYS:dd-mm-yyyy HH:MM:ss", // Formats the timestamp into a more readable date and time.
        ignore: "pid,hostname", // Removes the process ID (pid) and hostname from the log output to keep it concise.
        messageFormat: "{msg}", // Simplifies the output to show only the core log message.
    },
});

// Creates the main logger instance, passing in the configured transport.
// Any logs created using this `logger` instance will be processed by pino-pretty.
const logger = pino(transport);

// Exports the singleton logger instance so it can be imported and used throughout the application.
export default logger;
