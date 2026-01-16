// Paste this in browser console to add test data
// Then click PNG and SVG buttons to test exports

// Set title
app.diagram.title = "API Call Flow Diagram";
app.elements.diagramTitle.value = app.diagram.title;

// Set start time
app.diagram.startTime = "14:30:00 000";
app.elements.startTime.value = app.diagram.startTime;

// Clear existing data
app.diagram.lanes = [];
app.diagram.boxes = [];
app.diagram.nextLaneId = 1;
app.diagram.nextBoxId = 1;

// Add lanes with various name lengths
app.diagram.addLane("API Gateway");
app.diagram.addLane("Authentication Service Handler");
app.diagram.addLane("User Database");
app.diagram.addLane("Cache Layer");
app.diagram.addLane("Response Formatter Service");

// Add boxes to lanes
// Lane 1: API Gateway
app.diagram.addBox(1, 0, 150, "Request", "#EF5350");
app.diagram.addBox(1, 800, 100, "Response", "#EF5350");

// Lane 2: Auth Service (long name)
app.diagram.addBox(2, 150, 200, "Validate Token", "#26A69A");
app.diagram.addBox(2, 600, 150, "Generate Session", "#2DD4BF");

// Lane 3: Database
app.diagram.addBox(3, 350, 250, "Query User", "#AB47BC");

// Lane 4: Cache
app.diagram.addBox(4, 200, 100, "Check Cache", "#66BB6A");
app.diagram.addBox(4, 750, 50, "Update Cache", "#4ADE80");

// Lane 5: Response Formatter
app.diagram.addBox(5, 600, 200, "Format JSON", "#5C6BC0");

// Re-render everything
renderLaneList();
renderLanesCanvas();
renderTimelineRuler();
renderTimeMarkers();
renderAlignmentMarkers();
updateTotalDuration();

console.log("Test data loaded! Now click PNG and SVG buttons to test exports.");
