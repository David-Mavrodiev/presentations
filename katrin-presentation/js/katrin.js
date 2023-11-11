function drawChart() {
    let ctx = document.getElementById("accessabillity-chart");

    let data = {
        datasets: [{
            label: '# of Votes',
            data: [15, 8, 7, 7, 63],
            backgroundColor: [
                'rgb(82, 118, 169, 0.8)',
                'rgba(54, 162, 235, 0.8)',
                'rgb(173, 186, 212, 0.8)',
                'rgb(42, 73, 121, 0.8)',
                'rgb(62, 90, 131, 0.8)',
            ],
            borderColor: [
                'rgb(82, 118, 169, 0.5)',
                'rgba(54, 162, 235, 1)',
                'rgb(173, 186, 212, 1)',
                'rgb(42, 73, 121, 1)',
                'rgb(62, 90, 131, 1)',
            ],
            borderWidth: 1,
            labels: {
                render: 'label',
                arc: true,
                position: 'border',
            }
        }],
        labels: [
            'Reading difficulties',
            'Color blindness',
            'Dexterity difficulties',
            'Other',
            'Non-Difficulty'
        ]
    };

    var myPieChart = new Chart(ctx, {
        type: 'pie',
        data: data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                labels: {
                    render: 'label',
                    precision: 0,
                    showZero: true,
                    fontSize: 10,
                    fontColor: '#fff',
                    shadowBlur: 10,
                    shadowOffsetX: -5,
                    shadowOffsetY: 5,
                    shadowColor: 'rgba(255,0,0,0.75)',
                    position: 'default',
                    overlap: true,
                    showActualPercentages: true,
                    outsidePadding: 4,
                    textMargin: 4
                }
            },
            legend: {
                display: false
            }
        }
    });
}