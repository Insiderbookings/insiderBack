let ioRef = null;

export const setIOReference = (io) => {
  ioRef = io;
};

export const getIO = () => ioRef;

export const emitToRoom = (room, event, payload) => {
  const io = getIO();
  if (!io) return;
  io.to(room).emit(event, payload);
};

export const emitToUser = (userId, event, payload) => {
  const io = getIO();
  if (!io) return;
  io.to(`user:${userId}`).emit(event, payload);
};

export const joinUserRoom = (socket, userId) => {
  socket.join(`user:${userId}`);
};

export const leaveUserRoom = (socket, userId) => {
  socket.leave(`user:${userId}`);
};

export const joinChatRoom = (socket, chatId) => {
  socket.join(`chat:${chatId}`);
};

export const leaveChatRoom = (socket, chatId) => {
  socket.leave(`chat:${chatId}`);
};

