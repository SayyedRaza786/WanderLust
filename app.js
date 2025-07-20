if (process.env.NODE_ENV != "production") {
  require("dotenv").config();
}

// const fetch = require('node-fetch');

async function geocode(address) {
  const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`;
  const response = await fetch(url, { headers: { 'User-Agent': 'WanderlustApp/1.0' } });
  const data = await response.json();
  if (data && data.length > 0) {
    return {
      lat: parseFloat(data[0].lat),
      lon: parseFloat(data[0].lon)
    };
  }
  return null;
}

console.log(process.env.SECRET);
const express = require("express");
const app = express();
const mongoose = require("mongoose");
const wrapAsync = require("./utils/wrapAsync.js");
const path = require("path");
const methodOverride = require("method-override");
const ExpressError = require("./utils/ExpressError.js");
const Listing = require("./Models/listing.js");
const ejsMate = require("ejs-mate");

const dbUrl = process.env.ATLASDB_URL;
const Schema = mongoose.Schema;
const passportLocalMongoose = require("passport-local-mongoose");
const passport = require("passport");
const LocalStrategy = require("passport-local");

const multer = require("multer");
const { storage } = require("./cloudConfig.js");
const upload = multer({ storage });

const Review = require("./Models/review.js");
const session = require("express-session");
const flash = require("connect-flash");
const router = express.Router();
const mbxGeocoding= require('@mapbox/mapbox-sdk/services/geocoding');

const MongoStore = require("connect-mongo")
async function main() {
  await mongoose.connect(dbUrl);
}

main()
  .then(() => {
    console.log("Connected to the database");
  })
  .catch((err) => {
    console.log(err);
  });



app.use(methodOverride("_method"));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.engine("ejs", ejsMate);
app.use(express.static(path.join(__dirname, "/public")));


const store = MongoStore.create({
  mongoUrl : dbUrl,
  crypto : {
    secret : process.env.SECRET,
  },
  touchAfter : 24 * 3600,
})

store.on("error", function(err) {
  console.log("Error in Mongo Session Store", err);
});

const sessionOptions = {
  store,
  secret: process.env.SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: {
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
  },
};



//Authentication and Authorization
const userSchema = new Schema({
  email: {
    type: String,
    required: true,
  },
});

userSchema.plugin(passportLocalMongoose);

const User = mongoose.model("User", userSchema);
module.exports = User;

app.use(session(sessionOptions));
app.use(flash());

app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

app.use((req, res, next) => {
  res.locals.currentUser = req.user;
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  next();
});

// app.get("/demouser", async (req, res) => {
//     let fakeUser = new User({
//         email : "student@gmail.com",
//         username : "raza-sayyed"
//     });

//     let registeredUser = await User.register(fakeUser, "helloworld")
//     res.send(registeredUser)
// })

//Index Route
app.get("/listings", async (req, res) => {
  const allListings = await Listing.find({});
  res.render("listings/index.ejs", { allListings });
});

//New Route
app.get("/listings/new", (req, res) => {
  res.render("listings/new.ejs");
});

//Signup and Signin Routes
app.get("/signup", (req, res) => {
  res.render("users/signup.ejs");
});

app.post("/signup", async (req, res) => {
  try {
    let { username, email, password } = req.body;
    const newUser = new User({ email, username });
    const registeredUser = await User.register(newUser, password);
    console.log(registeredUser);
    // Auto-login after signup:
    req.login(registeredUser, (err) => {
      if (err) return next(err);
      req.flash("success", "User was registered and logged in successfully");
      res.redirect("/listings");
    });
  } catch (err) {
    req.flash("error", err.message);
    res.redirect("/signup");
  }
});

app.get("/login", (req, res) => {
  res.render("users/login.ejs");
});

app.post(
  "/login",
  passport.authenticate("local", {
    failureRedirect: "/login",
    failureFlash: true,
  }),
  async (req, res) => {
    req.flash("success", "Welcome to Wanderlust ! You are logged in ");
    res.redirect("/listings");
  }
);
//Show Route
app.get("/listings/:id", async (req, res) => {
  let { id } = req.params;
  const listing = await Listing.findById(id).populate({
    path: "reviews",
    populate: { path: "author" },
  });

  if (!listing) {
    req.flash("error", "This listing does not exists");
    return res.redirect("/listings");
  }
  res.render("listings/show.ejs", { listing });
});

//Create Route
app.post(
  "/listings",
  upload.single("listing[image]"),
  async (req, res, next) => {
    // Geocode the location string
    const coords = await geocode(req.body.listing.location);

    let url = req.file.path;
    let filename = req.file.filename;

    const newListing = new Listing(req.body.listing);
    newListing.image = { url, filename };
    if (coords) {
      newListing.geometry = {
        type: "Point",
        coordinates: [coords.lon, coords.lat], // [lng, lat]
      };
    }
    await newListing.save();
    req.flash("success", "New Listing Created!");
    res.redirect("/listings");
  }
);

//Edit Route
app.get("/listings/:id/edit", async (req, res) => {
  let { id } = req.params;
  const listing = await Listing.findById(id);
  if (!listing) {
    req.flash("error", "This listing does not exists");
    return res.redirect("/listings");
  }
  res.render("listings/edit.ejs", { listing,});
});

//Update Route
app.put("/listings/:id", upload.single("listing[image]"), async (req, res) => {
  let { id } = req.params;
  let listing = await Listing.findByIdAndUpdate(id, { ...req.body.listing });

  if (typeof req.file !== "undefined") {
    let url = req.file.path;
    let filename = req.file.filename;
    listing.image = { url, filename };
    await listing.save();
  }
  req.flash("success", "Listing Updated");
  res.redirect(`/listings/${id}`);
});

//Delete Route
app.delete("/listings/:id", async (req, res) => {
  let { id } = req.params;
  let deletedListing = await Listing.findByIdAndDelete(id);
  console.log(deletedListing);
  req.flash("success", "Listing Deleted ");
  res.redirect("/listings");
});

//Reviews
//Post Review Route

function isLoggedIn(req, res, next) {
  if (!req.isAuthenticated()) {
    req.flash("error", "You must be signed in to do that!");
    return res.redirect("/login");
  }
  next();
}

app.post("/listings/:id/reviews", isLoggedIn, async (req, res) => {
  let listing = await Listing.findById(req.params.id);
  let newReview = new Review(req.body.review);
  newReview.author = req.user._id; // <-- Save the logged-in user as author
  listing.reviews.push(newReview);

  await newReview.save();
  await listing.save();
  req.flash("success", "New Review Added");

  console.log("New review saved");

  res.redirect(`/listings/${listing._id}`);
});

//Delete Review Route
app.delete(
  "/listings/:id/reviews/:reviewId",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    let { id, reviewId } = req.params;
    const review = await Review.findById(reviewId);
    if (!review.author.equals(req.user._id)) {
      req.flash("error", "You do not have permission to delete this review.");
      return res.redirect(`/listings/${id}`);
    }
    await Listing.findByIdAndUpdate(id, { $pull: { reviews: reviewId } });
    await Review.findByIdAndDelete(reviewId);
    req.flash("success", "Review Deleted");
    res.redirect(`/listings/${id}`);
  })
);

//Error handling Middleware

// app.get("/err", (req, res) => {
//     abcd = abcd;
// })

// app.use((err, req, res, next) => {
//     console.log("-----ERROR-----")
//     next(err);
// })

// app.use((req, res) => {
//     res.status(404).send("Page not found")
// })

// app.all("*", (req, res, next) => {
//     next(new ExpressError(404, "Page not Found!"))
// })

//Error Handling middleware
app.use((err, req, res, next) => {
  let { statusCode = 500, message = "Something went wrong!!" } = err;
  res.status(statusCode).render("error.ejs", { err });
});

//Creation Route
// app.get("/testListing", async (req, res) => {
//     try {
//         let sampleListing = new Listing({
//             title: "My new Villa",
//             description: "The best Possible home you can get at this price range",
//             price: 20000,
//             location: "Chumta Mohalla, Bhusawal",
//             country: "India"
//         });
//         await sampleListing.save();
//         console.log("Sample was saved :)");
//         res.send("Successful Testing");
//     } catch (err) {
//         console.log("Error saving sample:", err);
//         res.status(500).send("Error saving sample");
//     }
// });
app.listen(8080, () => {
  console.log("The port is listening at 8080");
});
