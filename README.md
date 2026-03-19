# Inmate_BE

 - canteen inventory delete is not integrated
 - search functionality for store inventory data,invoice number ,vendor name, item  

 GET [/api/vendor-purchases?invoiceNo=INV-001](http://localhost:5000/inventory?invoiceNo=INV004)

GET [/api/vendor-purchases?vendorName=Fresh&itemName=Soap&page=2&limit=5](http://localhost:5000/inventory?vendorName=Fresh&itemName=Soap&page=2&limit=5)
GET [/api/vendor-purchases?sortField=totalAmount&sortOrder=asc](http://localhost:5000/inventory?sortField=totalAmount&sortOrder=asc)


GET /canteen?search=chips
GET /canteen?search=ITM001
GET /canteen?search=Snacks&page=2&limit=20