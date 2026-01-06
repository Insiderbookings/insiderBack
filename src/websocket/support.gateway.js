import {
    emitAdminActivity
} from "./emitter.js";

// Helper to join rooms
const joinRoom = (socket, room) => socket.join(room);
const leaveRoom = (socket, room) => socket.leave(room);

export default function registerSupportGateway(io, socket) {
    const user = socket.data.user;
    if (!user) return;

    const isAdmin = user.role === 100;

    // Admins subscribe to the global support feed
    if (isAdmin) {
        socket.on("support:subscribe", () => {
            joinRoom(socket, "admin:support");
            console.log(`Admin ${user.id} subscribed to support channel`);
        });

        socket.on("support:unsubscribe", () => {
            leaveRoom(socket, "admin:support");
        });
    }

    // Users and Admins can signal typing in a specific ticket
    socket.on("support:typing", ({ ticketId }) => {
        // Broadcast to specific ticket room (if we implemented per-ticket rooms)
        // or simply direct to the other party.
        // For now, let's keep it simple: if Admin types, notify User. If User types, notify Admin room.

        if (isAdmin) {
            // Notify the user owning the ticket (We need to payload this potentially or fetch ticket owner)
            // Ideally client sends { ticketId, recipientId } to save a DB call here.
            // For MVP, broadcast to "admin:support" might be too noisy, so we skip "typing" for now 
            // unless we implement per-ticket rooms `support:ticket:{id}`.
        }
    });

    // Subscribe to specific ticket updates (for chat view)
    socket.on("support:ticket:subscribe", ({ ticketId }) => {
        // Check permissions (Owner or Admin) - simplified here, ideally check DB
        joinRoom(socket, `support:ticket:${ticketId}`);
    });

    socket.on("support:ticket:unsubscribe", ({ ticketId }) => {
        leaveRoom(socket, `support:ticket:${ticketId}`);
    });
}
