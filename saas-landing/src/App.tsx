import './App.css'

function App() {
  return (
    <div className="app">
      <header className="header">
        <nav className="nav">
          <div className="logo">Brew House</div>
          <ul className="nav-links">
            <li><a href="#menu">Menu</a></li>
            <li><a href="#about">About</a></li>
            <li><a href="#contact">Contact</a></li>
          </ul>
          <button className="btn btn-primary">Visit Us</button>
        </nav>
      </header>

      <main>
        <section className="hero" id="hero">
          <div className="hero-content">
            <h1 className="hero-title">Artisan Coffee, Perfectly Brewed</h1>
            <p className="hero-subtitle">
              Experience the finest coffee beans sourced from around the world, expertly roasted and crafted by our passionate baristas.
            </p>
            <div className="hero-cta">
              <button className="btn btn-primary btn-large">Order Now</button>
              <button className="btn btn-secondary btn-large">View Menu</button>
            </div>
            <p className="hero-trust">Open daily 7 AM - 8 PM · Free WiFi · Pet-friendly</p>
          </div>
          <div className="hero-image">
            <div className "coffee-mockup">
              <div className="coffee-beans">
                <div className="bean"></div>
                <div className="bean"></div>
                <div className="bean"></div>
                <div className="bean"></div>
                <div className="bean"></div>
              </div>
              <div className "cup">
                <div className "steam"></div>
              </div>
            </div>
          </div>
        </section>

        <section className="menu" id="menu">
          <div className="container">
            <h2 className="section-title">Our Menu</h2>
            <p className="section-subtitle">Handcrafted beverages and delicious treats</p>
            <div className="menu-grid">
              <div className="menu-card hot">
                <h3>Classic Latte</h3>
                <p>Espresso with steamed milk</p>
                <span className="price">$4.50</span>
              </div>
              <div className="menu-card hot">
                <h3>Cappuccino</h3>
                <p>Equal parts espresso, steamed milk, and foam</p>
                <span className="price">$4.75</span>
              </div>
              <div className="menu-card hot">
                <h3>Americano</h3>
                <p>Espresso with hot water</p>
                <span className="price">$4.25</span>
              </div>
              <div className="menu-card cold">
                <h3>Cold Brew</h3>
                <p>Smooth cold-extracted coffee</p>
                <span className="price">$5.00</span>
              </div>
              <div className="menu-card cold">
                <h3>Iced Latte</h3>
                <p>Espresso over ice with cold milk</p>
                <span className="price">$4.75</span>
              </div>
              <div className="menu-card cold">
                <h3>Matcha Latte</h3>
                <p>Premium matcha with steamed milk</p>
                <span className="price">$5.25</span>
              </div>
              <div className "menu-card food">
                <h3>Croissant</h3>
                <p>Butter flaky pastry</p>
                <span className="price">$3.50</span>
              </div>
              <div className="menu-card food">
                <h3>Blueberry Muffin</h3>
                <p>Fresh baked with blueberries</p>
                <span className="price">$3.75</span>
              </div>
              <div className="menu-card food">
                <h3>Chocolate Chip Cookie</h3>
                <p>Warm baked cookie</p>
                <span className="price">$2.75</span>
              </div>
            </div>
          </div>
        </section>

        <section className="about" id="about">
          <div className="container">
            <div className="about-grid">
              <div className="about-image">
                <div className "coffee-beans-large">
                  <div className "bean"></div>
                  <div className "bean"></div>
                  <div className "bean"></div>
                  <div className "bean"></div>
                  <div className "bean"></div>
                </div>
                <div className "coffee-bag">
                  <div className "bag-text">Single Origin</div>
                </div>
              </div>
              <div className "about-content">
                <h2 className "section-title">About Brew House</h2>
                <p>Founded in 2020, Brew House began as a small neighborhood coffee shop with a big dream: to bring people together over exceptional coffee. We source our beans directly from sustainable farms, roast them in small batches, and serve every cup with care.</p>
                <p>Our mission is simple: create a warm, welcoming space where friends can catch up, workers can focus, and everyone can find their perfect cup. From our signature espresso drinks to our cozy atmosphere, every detail is designed to enhance your coffee experience.</p>
                <div className "about-stats">
                  <div className "stat">
                    <span className "stat-number">150+</span>
                    <span className "stat-label">Happy Customers</span>
                  </div>
                  <div className "stat">
                    <span className "stat-number">5</span>
                    <span className "stat-label">Years</span>
                  </div>
                  <div className "stat">
                    <span className "stat-number">3</span>
                    <span className "stat-label">Awards</span>
                  </div>
                  <div className "stat">
                    <span className "stat-number">1</span>
                    <span className "stat-label">Roastery</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="contact" id="contact">
          <div className="container">
            <h2 className="section-title">Visit Us</h2>
            <p>We'd love to see you! Come find us at our cozy location.</p>
            <div className "contact-grid">
              <div className "contact-info">
                <h3>Location</h3>
                <p>123 Coffee Street,<br/>Hometown, CA 12345</p>
                <p>Open daily 7 AM - 8 PM</p>
                <hr />
                <h3>Hours</h3>
                <p>Monday - Friday: 7 AM - 8 PM</p>
                <p>Saturday - Sunday: 8 AM - 9 PM</p>
                <hr />
                <h3>Phone</h3>
                <p>(555) 123-4567</p>
              </div>
              <div className "contact-form">
                <h3>Send Us a Message</h3>
                <form>
                  <div className "form-group">
                    <input type="text" placeholder="Your Name" required />
                  </div>
                  <div className "form-group">
                    <input type="email" placeholder="Your Email" required />
                  </div>
                  <div className "form-group">
                    <textarea placeholder="Your Message" required /></textarea>
                  </div>
                  <button type="submit" className="btn btn-primary btn-large">Send Message</button>
                </form>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="container">
          <div className "footer-grid">
            <div className "footer-brand">
              <div className "logo">Brew House</div>
              <p>Artisan coffee since 2020</p>
            </div>
            <div className "footer-links">
              <div>
                <h4>Menu</h4>
                <ul>
                  <li><a href="#menu">Drinks</a></li>
                  <li><a href="#menu">Food</a></li>
                </ul>
              </div>
              <div>
                <h4>Location</h4>
                <ul>
                  <li><a href="#contact">Visit Us</a></li>
                </ul>
              </div>
              <div>
                <h4>Connect</h4>
                <ul>
                  <li><a href="#">Instagram</a></li>
                  <li><a href="#">Twitter</a></li>
                  <li><a href="#">Facebook</a></li>
                </ul>
              </div>
            </div>
            <div className "footer-legal">
              <p>&copy; 2024 Brew House. All rights reserved.</p>
              <p>Privacy Policy · Terms of Service</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default App