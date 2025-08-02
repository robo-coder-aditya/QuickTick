import express from "express";
import session from "express-session";
import pg from "pg";
import bcrypt from "bcrypt";
import path from "path";
import { fileURLToPath } from "url";
import { error } from "console";
import csurf from "csurf";
import dotenv from "dotenv";
import pgSession from "connect-pg-simple";


dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT||3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({extended: true}));

const pgSessionStore = pgSession(session); 

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});


app.use(session({
  store: new pgSessionStore({
    pool: db, //
    tableName: "session"
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: 30 * 60 * 1000,
    httpOnly: true
  }
}));


app.use(express.static("public"));

app.use(csurf());
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  next();
});





//front-page
app.get("/", (req, res) =>{
    res.sendFile(path.join(__dirname, "public", "frontPage.html"));

    console.log("Database URL: ", process.env.DATABASE_URL);
})

//to get the signup form
app.get("/signup", (req, res) =>{
    res.render("signup");
})

//to get the login form
app.get("/loginform", (req, res) =>{
    res.render("login");
})

//to get FAQs
app.get("/faq", (req, res) =>{
    res.sendFile(path.join(__dirname, "public", "faq.html"));
});

//to signup
app.post("/register", async (req, res) =>{
    const username = req.body.username;
    const password = req.body.password;
    const confirmPassword = req.body.confirmPassword;

    if(username.length==0 && password.length == 0) return res.render("signup", {errorMessage: "Username and Password cannot be empty!"});

    if(username.length==0) return res.render("signup", {errorMessage: "Username cannot be empty"});

    if(password==="" || confirmPassword == "") return res.render("signup", {
        oldUsername: username,
        errorMessage: "Please enter both passwords"
    });

    if(password != confirmPassword){
        return res.render("signup", { 
            oldUsername: username,
            errorMessage: "Passwords do not match"});
    }

    if(password.length < 4){
        return res.render("signup", {
            oldUsername: username,
            errorMessage: "Password should be atleast 4 characters"});
    }

    try{
        const result = await db.query("SELECT * FROM users WHERE username = $1", [username]);
        if(result.rows.length!=0) return res.render("signup", { errorMessage: "Username already taken"});
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.query("INSERT INTO users(username, password) VALUES($1, $2)", [username, hashedPassword]);

        const data = await db.query("SELECT * FROM users WHERE username = $1", [username]);
        const userId = data.rows[0].id;
        req.session.userId = userId;
        req.session.username = username;
        res.redirect("/select");
    }
    catch(error){
        console.log(error);
        res.render("signup", { errorMessage: "Something went wrong, Please try again !"});
    }

});

//to login
app.post("/login", async(req, res)=>{
    const username = req.body.username;
    const password = req.body.password;

    if(username.length == 0 && password.length == 0) return res.render("login", {errorMessage: "Please enter your Username and Password"});
    if(username.length == 0) return res.render("login", {errorMessage: "Please enter your Username"});
    if(password.length == 0 ) return res.render("login", {
        oldUsername: username,
        errorMessage: "Please enter your Password"});

    
    try{
        const result = await db.query("SELECT * FROM users WHERE username = $1", [username]);
        if(result.rows.length == 0) return res.render("login", {errorMessage: "User not found !"});
        const hashedPassword = result.rows[0].password;
        const userId = result.rows[0].id;
        const match = await bcrypt.compare(password, hashedPassword);
        if(match){
            req.session.userId = userId;
            req.session.username = username;
            res.redirect("/select");
        }
        else res.render("login", {
            oldUsername: username,
            errorMessage: "Invalid Password"});
    }
    catch(error){
        console.log(error);
        res.render("login", {errorMessage: "Something went wrong, Please try again !"})
    }
});

//to check for authentication
function isAuthenticated(req, res, next) {
  if (req.session.userId) return next();  // 🔁 Continue to the next thing
  res.redirect("/loginform");             // ❌ Otherwise, redirect to login
}

//to get selection page
app.get("/select", isAuthenticated, (req, res) =>{
    try{
        res.render("selectionPage", {username: req.session.username});
    }
    catch(error){
        console.log(error);
        res.render("login", {
            errorMessage: "Something went wrong, Please try again !"});
    }
});

//to confirm selection and go to next page;
app.post("/select", (req, res) =>{
    const allowedPlans = ["daily", "weekly", "monthly"];
    const selectedPlan = req.body.plan;
    if(!selectedPlan || !allowedPlans.includes(selectedPlan)) return res.render("selectionPage", {
        username: req.session.username,
        errorMessage: "Please select a valid plan"});
    res.redirect(`/${selectedPlan}`);
});

//to render daily tasks;
app.get("/daily", isAuthenticated, async (req, res) =>{
    const userid = req.session.userId;
    const userName = req.session.username;
    const result = await db.query("SELECT * FROM daily WHERE user_id = $1 AND created_at::date = CURRENT_DATE ORDER BY created_at", [userid]);
    const remainingTasks = result.rows;
    const numberOfRemainingTasks = remainingTasks.length;
    const type = "daily";
    const today = new Date().toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });

    const response = await db.query("SELECT * FROM completed WHERE type = $1 AND user_id = $2 AND completion_time::date = CURRENT_DATE ORDER BY completion_time", [type, userid]);
    const completedTasks = response.rows;
    const numberOfCompletedTasks = completedTasks.length;

    const totalTasks = numberOfRemainingTasks + numberOfCompletedTasks;

    res.render("daily", {
        today: today,
        username: userName,
        currentTasks: remainingTasks,
        completedTasks: completedTasks,
        inProgress: numberOfRemainingTasks,
        completed: numberOfCompletedTasks,
        totalTasks: totalTasks
    })
});

//to render weekly tasks;
app.get("/weekly", isAuthenticated, async(req, res) => {
    const userid = req.session.userId;
    const userName = req.session.username;
    const result = await db.query(`SELECT * FROM weekly WHERE user_id = $1 
        AND created_at::date >= date_trunc('week', CURRENT_DATE)::date
        AND created_at::date < (date_trunc('week', CURRENT_DATE) + interval '1 week')::date
        ORDER BY created_at`, 
        [userid]);
    const remainingTasks = result.rows;
    const numberOfRemainingTasks = remainingTasks.length;
    const type = "weekly";
    const today = new Date().toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });

    const response = await db.query(`SELECT * FROM completed WHERE type = $1
        AND user_id = $2
        AND completion_time::date >= date_trunc('week', CURRENT_DATE)::date
        AND completion_time::date <(date_trunc('week', CURRENT_DATE) + interval '1 week')::date
        ORDER BY completion_time`,
        [type, userid]
    );
    const completedTasks = response.rows;
    const numberOfCompletedTasks = completedTasks.length;

    const totalTasks = numberOfRemainingTasks + numberOfCompletedTasks;

    res.render("weekly", {
        today: today,
        username: userName,
        currentTasks: remainingTasks,
        completedTasks: completedTasks,
        inProgress: numberOfRemainingTasks,
        completed: numberOfCompletedTasks,
        totalTasks: totalTasks
    })
});

//to render monthly tasks
app.get("/monthly", isAuthenticated,async (req, res) =>{
    const userid = req.session.userId;
    const userName = req.session.username;
    const result = await db.query(`SELECT * FROM monthly WHERE user_id = $1
        AND created_at::date >= date_trunc('month', CURRENT_DATE)::date
        AND created_at::date < (date_trunc('month', CURRENT_DATE) + interval '1 month')::date
        ORDER BY created_at`,
        [userid]
    );
    const remainingTasks = result.rows;
    const numberOfRemainingTasks = remainingTasks.length;
    const type = "monthly";
    const today = new Date().toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });

    const response = await db.query(`SELECT * FROM completed WHERE type = $1
        AND user_id = $2
        AND completion_time::date >= date_trunc('month', CURRENT_DATE)::date
        AND completion_time::date < (date_trunc('month', CURRENT_DATE) + interval '1 month')::date
        ORDER BY completion_time`, 
        [type, userid]
    );
    const completedTasks = response.rows;
    const numberOfCompletedTasks = completedTasks.length;

    const totalTasks = numberOfRemainingTasks + numberOfCompletedTasks;

    res.render("monthly", {
        today: today,
        username: userName,
        currentTasks: remainingTasks,
        completedTasks: completedTasks,
        inProgress: numberOfRemainingTasks,
        completed: numberOfCompletedTasks,
        totalTasks: totalTasks
    })
});

//to delete a task from daily, and add to completed;
app.post("/deleteDaily", isAuthenticated,async (req, res) =>{
    try{
        const taskId = req.body.deleteTaskId;
        const userId = req.session.userId;
        const task = await db.query("SELECT * from daily WHERE id = $1 AND user_id = $2", [taskId, userId]);

        if(task.rows.length===0) return res.status(403).sendFile(path.join(__dirname, "public", "errorPage403.html"))

        const completedTaskTitle = task.rows[0].title;
        
        const type = "daily"

        await db.query(`INSERT INTO completed(title, user_id, type) VALUES ($1, $2, $3)`, [completedTaskTitle, userId, type]);
        await db.query("DELETE FROM daily WHERE id = $1 and user_id = $2", [taskId, userId]);
        res.redirect("/daily");
    }
    catch(error){
        console.log(error);
        res.status(500).sendFile(path.join(__dirname, "public", "errorPage500.html"));
    }
});

//to edit an exisiting dask from daily tasks;
app.post("/editDaily", isAuthenticated,async (req, res)=>{
    try{
        const taskId = req.body.updatedTaskId;
        const taskTitle = req.body.updatedTaskTitle
        const taskTime = req.body.updatedTaskTime;
        const userId = req.session.userId;

        const taskCheck = await db.query("SELECT * FROM daily WHERE id = $1 AND user_id = $2", [taskId, userId]);
        if(taskCheck.rows.length===0) return res.status(403).sendFile(path.join(__dirname, "public", "errorPage403.html"))

        await db.query(`UPDATE daily SET title = $1, scheduled_time = $2 WHERE id = $3 AND user_id=$4`, [taskTitle, taskTime, taskId, userId]);
        res.redirect("/daily");

    }
    catch(error){
        console.log(error);
        res.status(500).sendFile(path.join(__dirname, "public", "errorPage500.html"));
    }
})

//to render add task form
app.get("/addDaily", isAuthenticated, (req, res)=>{
    res.render("addDailyForm", {username: req.session.username});
})

//to add a task to daily 
app.post("/addDaily", isAuthenticated, async(req, res)=>{

    const userId = req.session.userId;
    const username = req.session.username;
    const taskTitle = req.body.newTaskTitle.trim();
    const taskTime = req.body.newTaskTime.trim();
    
    if(taskTitle === "") return res.render("addDailyForm", {
        username: username,
        oldTime: taskTime,
        errorMessage: "Please enter the task"});
    try{

        await db.query("INSERT INTO daily(user_id, title, scheduled_time) VALUES ($1, $2, $3)", [userId, taskTitle, taskTime]);
        res.redirect("/daily");
    }
    catch(error){
        console.log(error);
        res.status(500).sendFile(path.join(__dirname, "public", "errorPage500.html"));
    }
    
})

//to revert a daily task
app.post("/revertDaily", isAuthenticated, async (req, res) =>{

    try{
        const userId = req.session.userId;
        const taskTitle = req.body.taskTitle;
        const taskId = req.body.taskId;

        await db.query("DELETE FROM completed where id = $1 AND user_id = $2", [taskId, userId]);

        await db.query("INSERT INTO daily(title, user_id) values($1, $2)", [taskTitle, userId]);
        
        res.redirect("/daily");
    }
    catch(error){
        console.log(error);
        res.status(500).sendFile(path.join(__dirname, "public", "errorPage500.html"));
    }
})

//to delete a weekly task, and add it to completed;
app.post("/deleteWeekly", isAuthenticated, async(req, res) =>{
    try{
        const taskId = req.body.deleteTaskId;
        const userId = req.session.userId;

        const task = await db.query("SELECT * FROM weekly WHERE id = $1 AND user_id=$2", [taskId, userId]);

        if(task.rows.length===0) return res.status(403).sendFile(path.join(__dirname, "public", "errorPage403.html"))

        const completedTask = task.rows[0];
        const completedTaskTitle = completedTask.title;
        const type = "weekly";
        

        await db.query("INSERT INTO completed(title, type, user_id) VALUES($1, $2, $3)", [completedTaskTitle, type, userId]);
        await db.query("DELETE FROM weekly WHERE id = $1 and user_id = $2", [taskId, userId]);
        res.redirect("/weekly");
    }
    catch(error){
        console.log(error);
        res.status(500).sendFile(path.join(__dirname, "public", "errorPage500.html"));
    }
})

//to edit an existing task from weekly tasks;
app.post("/editWeekly", isAuthenticated, async(req, res) =>{
    try{
        const taskId = req.body.updatedTaskId;
        const taskTitle = req.body.updatedTaskTitle
        const taskNote = req.body.updatedTaskNote;
        const userId = req.session.userId;

        const taskCheck = await db.query("SELECT * FROM weekly WHERE id = $1 AND user_id = $2", [taskId, userId]);
        if(taskCheck.rows.length===0) return res.status(403).sendFile(path.join(__dirname, "public", "errorPage403.html"))

        await db.query("UPDATE weekly SET title = $1, note = $2 WHERE id = $3 AND user_id = $4", [taskTitle, taskNote, taskId, userId]);
        res.redirect("/weekly");
    }
    catch(error){
        console.log(error);
        res.status(500).sendFile(path.join(__dirname, "public", "errorPage500.html"));
    }
});


//to render add weekly task form
app.get("/addWeekly", isAuthenticated, (req, res)=>{
    res.render("addWeeklyform", {
        oldNote: "",
        username: req.session.username});
})


//to add a task to weekly
app.post("/addWeekly", isAuthenticated, async(req, res)=>{

    const userId = req.session.userId;
    const taskTitle = req.body.newTaskTitle.trim();
    const taskNote = req.body.newTaskNote.trim();
    const username = req.session.username;
    
    if(taskTitle === "") return res.render("addWeeklyform", {
        username: username,
        errorMessage: "Please enter the task",
        oldNote: taskNote
    })

    try{

        await db.query("INSERT INTO weekly(user_id, title, note) VALUES ($1, $2, $3)", [userId, taskTitle, taskNote]);
        res.redirect("/weekly");
    }
    catch(error){
        console.log(error);
        res.status(500).sendFile(path.join(__dirname, "public", "errorPage500.html"));
    }
});

//to revert a weekly task
app.post("/revertWeekly", isAuthenticated, async (req, res) =>{
    try{
        const userId = req.session.userId;
        const taskTitle = req.body.taskTitle;
        const taskId = req.body.taskId;

        await db.query("DELETE FROM completed where id = $1 AND user_id = $2", [taskId, userId]);

        await db.query("INSERT INTO weekly(title, user_id) values($1, $2)", [taskTitle, userId]);
        
        res.redirect("/weekly");
    }
    catch(error){
        console.log(error);
        res.status(500).sendFile(path.join(__dirname, "public", "errorPage500.html"));
    }
})

//to delete a task from monthly tasks and add to completed;
app.post("/deleteMonthly", isAuthenticated, async(req, res)=> {
    try{
        const taskId = req.body.deleteTaskId;
        const userId = req.session.userId;

        const task = await db.query("SELECT * FROM monthly WHERE id = $1 AND user_id = $2", [taskId, userId]);
        if(task.rows.length===0) return res.status(403).sendFile(path.join(__dirname, "public", "errorPage403.html"))

        const completedTask = task.rows[0];
        const completedTaskTitle = completedTask.title;
        const type = "monthly";
            

        await db.query("INSERT INTO completed(title, type, user_id) VALUES($1, $2, $3)", [completedTaskTitle, type, userId]);
        await db.query("DELETE FROM monthly WHERE id = $1 and user_id = $2", [taskId, userId]);
        res.redirect("/monthly");
    }
    catch(error){
        console.log(error);
        res.status(500).sendFile(path.join(__dirname, "public", "errorPage500.html"));
    }
});

//to edit an existing task in monthly tasks
app.post("/editMonthly", isAuthenticated, async(req, res)=>{
    try{
        const taskId = req.body.updatedTaskId;
        const taskTitle = req.body.updatedTaskTitle.trim();
        const taskNote = req.body.updatedTaskNote.trim();
        const userId = req.session.userId;

        const taskCheck = await db.query("SELECT * FROM monthly WHERE id = $1 AND user_id = $2", [taskId, userId]);
        if(taskCheck.rows.length===0) return res.status(403).sendFile(path.join(__dirname, "public", "errorPage403.html"))

        await db.query("UPDATE monthly SET title = $1, note = $2 WHERE id = $3 AND user_id = $4", [taskTitle, taskNote, taskId, userId]);
        res.redirect("/monthly");
    }
    catch(error){
        console.log(error);
        res.status(500).sendFile(path.join(__dirname, "public", "errorPage500.html"));
    }
})


//to render add monthly task form
app.get("/addMonthly", isAuthenticated, (req, res)=>{
    res.render("addMonthlyForm", {
        oldNote: "",
        username: req.session.username});
})


//to add a task to monthly;
app.post("/addMonthly", isAuthenticated, async(req, res) =>{

    const username = req.session.username;
    const userId = req.session.userId;
    const taskTitle = req.body.newTaskTitle.trim();
    const taskNote = req.body.newTaskNote.trim();
    
    if(taskTitle === "") return res.render("addMonthlyForm", {
        username: username,
        errorMessage: "Please enter the task",
        oldNote: taskNote
    })

    try{

        await db.query("INSERT INTO monthly(user_id, title, note) VALUES ($1, $2, $3)", [userId, taskTitle, taskNote]);
        res.redirect("/monthly");
    }
    catch(error){
        console.log(error);
        res.status(500).sendFile(path.join(__dirname, "public", "errorPage500.html"));
    }
})

//to revert a monthly task
app.post("/revertMonthly", isAuthenticated, async(req, res) =>{

    try{
        const userId = req.session.userId;
        const taskTitle = req.body.taskTitle;
        const taskId = req.body.taskId;

        await db.query("DELETE FROM completed where id = $1 AND user_id = $2", [taskId, userId]);

        await db.query("INSERT INTO monthly(title, user_id) values($1, $2)", [taskTitle, userId]);
        
        res.redirect("/monthly");
    }
    catch(error){
        console.log(error);
        res.status(500).sendFile(path.join(__dirname, "public", "errorPage500.html"));
    }
})

//to go to the profile
app.get("/profile", isAuthenticated,(req, res) =>{
    res.render("profile", {username: req.session.username});
})

//to get the password change form
app.get("/changePassword", isAuthenticated, (req, res) =>{
    res.render("changePasswordForm", {username: req.session.username});
})

//to change password
app.post("/changePassword", isAuthenticated, async (req, res) =>{
    
    const username = req.session.username;
    const userId = req.session.userId;
    const password = req.body.existingPassword;
    const newPassword = req.body.newPassword;
    const confirmPassword = req.body.confirmPassword;

    if(password === "") return res.render("changePasswordForm", {
        username: username,
        errorMessage: "Please enter the existing password",
    });

    if(newPassword === "") return res.render("changePasswordForm", {
        username: username,
        errorMessage: "Please enter the new Password"
    })

    if(confirmPassword === "") return res.render("changePasswordForm", {
        username: username,
        errorMessage: "Please confirm the new Password"
    })

    if(newPassword != confirmPassword) return res.render("changePasswordForm", {
        username: username,
        errorMessage: "New password and confirmation password do not match"
    })

    if(newPassword.length<4) return res.render("changePasswordForm", {
        username: username,
        errorMessage: "New password must be at least 4 characters"
    })

    try{
        const result = await db.query("SELECT * FROM users WHERE id = $1", [userId]);
        const existingPassword = result.rows[0].password;
        const passwordMatch = await bcrypt.compare(password, existingPassword);
        if(!passwordMatch) return res.render("changePasswordForm", {
            username: username,
            errorMessage: "Incorrect current password"
        });
        const newHashedPassword = await bcrypt.hash(newPassword, 10);
        await db.query("UPDATE users SET password = $1 where id = $2", [newHashedPassword, userId]);
        const successMessage = "Password changed successfully";
        res.render("profile", {
            username: username,
            successMessage: successMessage
        })
    }
    catch(error){
        console.log(error);
        res.status(500).sendFile(path.join(__dirname, "public", "errorPage500.html"));
    }

});

//to LogOut from the app;
app.get("/logout", (req, res) =>{
    req.session.destroy((err) =>{
        if(err){
            console.log("Error message: ", err);
            res.status(500).sendFile(path.join(__dirname, "public", "errorPage500.html"));
        }
        res.clearCookie("connect.sid", {path: "/"});
        res.redirect("/");
    });
});

//csurf error handler
app.use((err, req, res, next) => {
  if (err.code === "EBADCSRFTOKEN") {
    res.status(403).sendFile(path.join(__dirname, "public", "errorPage403.html")); 
  } else {
    next(err); 
  }
});

//404 error handler
app.use((req, res)=>{
    res.status(404).sendFile(path.join(__dirname, "public", "errorPage404.html"));
})
//to initialize the server
app.listen(port, () =>{
    console.log(`Listening to port ${port}`);
})
