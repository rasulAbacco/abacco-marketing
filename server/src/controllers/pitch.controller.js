import prisma from "../prismaClient.js";

// Create pitch
export const createPitch = async (req, res) => {
  try {
    const { name, bodyHtml, type } = req.body;

    if (!name || !bodyHtml) {
      return res.status(400).json({
        success: false,
        message: "Pitch name and body are required",
      });
    }

    const pitch = await prisma.pitchTemplate.create({
      data: {
        userId: req.user.id,
        name,
        bodyHtml,
        type, 
      },
    });

    res.json({ success: true, data: pitch });
  } catch (err) {
    console.error("Create pitch error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Get all pitches
export const getPitches = async (req, res) => {
  try {
    const pitches = await prisma.pitchTemplate.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: pitches });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};

// Update pitch
export const updatePitch = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, bodyHtml, type } = req.body;

    const updated = await prisma.pitchTemplate.update({
      where: { id },
      data: { name, bodyHtml, type },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};

// Delete pitch
export const deletePitch = async (req, res) => {
  try {
    const id = Number(req.params.id);

    await prisma.pitchTemplate.delete({
      where: { id },
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};
