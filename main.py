from selenium import webdriver as wb
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.wait import WebDriverWait
from bs4 import BeautifulSoup as bs
from selenium.webdriver.support import expected_conditions as EC

url = r"https://www.zoopla.co.uk/to-rent/property/sw7-2az/?price_frequency=per_month&price_max=3000&price_min=450&q=SW7%202AZ&radius=10&search_source=to-rent&map_app=false"

options = Options()
options.page_load_strategy = 'eager'

driver = wb.Chrome(options = options)

wait = WebDriverWait(driver, timeout = 3, poll_frequency = .1)

driver.get(url)

wait.until(EC.presence_of_element_located((By.CLASS_NAME, r"_11nlkat0")))
html = driver.page_source

soup = bs(html, 'html.parser')

print(soup)
driver.quit()


